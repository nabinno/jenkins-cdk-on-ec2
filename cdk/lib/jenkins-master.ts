import * as ecr from '@aws-cdk/aws-ecr-assets';
import * as ecs from '@aws-cdk/aws-ecs';
import * as sd from '@aws-cdk/aws-servicediscovery';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as elb from '@aws-cdk/aws-elasticloadbalancingv2';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as cdk from '@aws-cdk/core';
import { Network } from  './network';
import { Ecs } from  './ecs';
import { JenkinsWorker } from './jenkins-worker';

interface JenkinsMasterProps extends cdk.StackProps {
  ecsCluster: Ecs,
  network: Network,
  worker: JenkinsWorker
}

export class JenkinsMaster extends cdk.Stack {
  public readonly workerSecurityGroup: ec2.SecurityGroup;
  public readonly workerExecutionRole: iam.Role;
  public readonly workerTaskRole: iam.Role;
  public readonly workerLogsGroup: logs.LogGroup;
  public readonly workerLogStream: logs.LogStream;

  constructor(scope: cdk.App, id: string, props: JenkinsMasterProps) {
    super(scope, id, props);

    const ecsCluster = props.ecsCluster
    const network = props.network
    const worker = props.worker
    const account = process.env.CDK_DEFAULT_ACCOUNT || '';
    const region = process.env.CDK_DEFAULT_REGION || '';

    /**
     * ECR
     */
    const asset = new ecr.DockerImageAsset(this, "JenkinsMasterDockerImage", {
      repositoryName: 'jenkins-master-production',
      directory: '../docker/master/'
    });
    const image = ecs.ContainerImage.fromDockerImageAsset(asset);

    /**
     * Fargate
     */
    const environment = {
      // https://github.com/jenkinsci/docker/blob/master/README.md#passing-jvm-parameters
      'JAVA_OPTS': '-Djenkins.install.runSetupWizard=false',
      // https://github.com/jenkinsci/configuration-as-code-plugin/blob/master/README.md#getting-started
      'CASC_JENKINS_CONFIG': '/config-as-code.yaml',
      'network_stack': network.stackName,
      'cluster_stack': ecsCluster.stackName,
      'worker_stack': worker.stackName,
      'cluster_arn': ecsCluster.cluster.clusterArn,
      'aws_region': region,
      'jenkins_url': "http://master.jenkins:8080",
      'subnet_ids': network.vpc.privateSubnets.map(x => x.subnetId).join(','),
      'security_group_ids': worker.workerSecurityGroup.securityGroupId,
      'execution_role_arn': worker.workerExecutionRole.roleArn,
      'task_role_arn': worker.workerTaskRole.roleArn,
      'worker_log_group': worker.workerLogsGroup.logGroupName,
      'worker_log_stream_prefix': worker.workerLogStream.logStreamName
    };

    // ECS: TaskDefinition
    const jenkinsMasterTask = new ecs.Ec2TaskDefinition(this, "JenkinsMasterTaskDef", {
      family: 'jenkins-master-production-task',
      networkMode: ecs.NetworkMode.AWS_VPC,
      volumes: [{ name: "efs_mount", host: { sourcePath: '/mnt/efs' } }],
    });
    jenkinsMasterTask.addContainer("JenkinsMasterContainer", {
      image: image,
      cpu: 512,
      memoryLimitMiB: 1024,
      environment: environment,
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "jenkins-master-prod-sg",
        logRetention: logs.RetentionDays.ONE_WEEK
      }),
    });
    jenkinsMasterTask.defaultContainer?.addMountPoints({
      containerPath: '/var/jenkins_home',
      sourceVolume: "efs_mount",
      readOnly: false,
    });
    jenkinsMasterTask.defaultContainer?.addPortMappings({ containerPort: 8080, hostPort: 8080 });

    // ECS: Service
    const serviceSecGrp = new ec2.SecurityGroup(this, "JenkinsMasterServiceSecGrp", {
      securityGroupName: "jenkins-master-prod-sg",
      vpc: network.vpc,
      allowAllOutbound: true,
    });
    serviceSecGrp.addIngressRule(worker.workerSecurityGroup, ec2.Port.tcp(50000), "from JenkinsWorkerSecurityGroup 50000");
    serviceSecGrp.addIngressRule(worker.workerSecurityGroup, ec2.Port.tcp(8080), "from JenkinsWorkerSecurityGroup 8080");
    const jenkinsMasterService = new ecs.Ec2Service(this, "EC2MasterService", {
      serviceName: 'jenkins-master-production-svc',
      taskDefinition: jenkinsMasterTask,
      cloudMapOptions: { name: "master", dnsRecordType: sd.DnsRecordType.A },
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      enableECSManagedTags: true,
      cluster: ecsCluster.cluster,
    });

    const albSecGrp = new ec2.SecurityGroup(this, "JenkinsMasterALBSecGrp", {
      securityGroupName: "jenkins-master-prod-alb-sg",
      vpc: network.vpc,
      allowAllOutbound: false,
    });
    albSecGrp.addIngressRule(ec2.Peer.ipv4("0.0.0.0/0"), ec2.Port.tcp(80), "Allow from anyone on port 80");
    albSecGrp.addEgressRule(serviceSecGrp, ec2.Port.tcp(8080), "Load balancer to target");
    const jenkinsLoadBalancer = new elb.ApplicationLoadBalancer(this, "JenkinsMasterELB", {
      loadBalancerName: "jenkins-master-production-alb",
      vpc: network.vpc,
      internetFacing: true,
    });
    const listener = jenkinsLoadBalancer.addListener("Listener", { port: 80 });
    listener.addTargets("JenkinsMasterTarget", {
      port: 80,
      targets: [
        jenkinsMasterService.loadBalancerTarget({
          containerName: jenkinsMasterTask.defaultContainer?.containerName || '',
          containerPort: 8080,
        })
      ],
      deregistrationDelay: cdk.Duration.seconds(10),
      healthCheck: { path: '/login' },
    });

    // ECS: TaskDefinition (RolePolicy)
    jenkinsMasterTask.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:ListClusters",
          "ecs:DescribeContainerInstances",
          "ecs:ListTaskDefinitions",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeTasks"
        ],
        resources: ["*"],
      })
    );
    jenkinsMasterTask.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:ListContainerInstances"],
        resources: [ecsCluster.cluster.clusterArn]
      })
    );
    jenkinsMasterTask.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        resources: [`arn:aws:ecs:${region}:${account}:task-definition/fargate-workers*`]
      })
    );
    jenkinsMasterTask.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:StopTask"],
        resources: [`arn:aws:ecs:${region}:${account}:task/*`],
        conditions: {
          "ForAnyValue:ArnEquals": {
            "ecs:cluster": ecsCluster.cluster.clusterArn
          }
        }
      })
    );
    jenkinsMasterTask.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [
          worker.workerTaskRole.roleArn,
          worker.workerExecutionRole.roleArn
        ]
      })
    );
  }
}
