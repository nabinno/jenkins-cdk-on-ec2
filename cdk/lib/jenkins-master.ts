import * as ecr from '@aws-cdk/aws-ecr-assets';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecs_patterns from '@aws-cdk/aws-ecs-patterns';
import * as sd from '@aws-cdk/aws-servicediscovery';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as cdk from '@aws-cdk/core';
import { Network } from  './network';
import { Ecs } from  './ecs';
import { JenkinsWorker } from './jenkins-worker';
import { LogDriver } from '@aws-cdk/aws-ecs';


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
    const account = process.env.CDK_DEFAULT_ACCOUNT;
    const region = process.env.CDK_DEFAULT_REGION || '';

    /**
     * ECR
     */
    const asset = new ecr.DockerImageAsset(this, "JenkinsMasterDockerImage", {
      repositoryName: 'jenkins/master',
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

    const taskDefinition = new ecs.FargateTaskDefinition(this, "JenkinsTaskDefinition", {
      family: 'jenkins',
      cpu: 512,
      memoryLimitMiB: 2048,
    });
    const container = taskDefinition.addContainer('master', {
      image: image,
      environment: environment,
      logging: LogDriver.awsLogs({ streamPrefix: "jenkinsLog" })
    });
    container.addPortMappings({ containerPort: 8080 });
    container.addPortMappings({ containerPort: 50000, hostPort: 50000 });

    const jenkinsMasterServiceMain = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "JenkinsMasterService", {
      serviceName: 'jenkins-svc',
      cluster: ecsCluster.cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      enableECSManagedTags: true,
      publicLoadBalancer: true,
      assignPublicIp: true,
      cloudMapOptions: {
        name: "master",
        dnsRecordType: sd.DnsRecordType.A,
      },
    });

    // Fargate: Service
    const jenkinsMasterService = jenkinsMasterServiceMain.service;
    jenkinsMasterService.connections.allowFrom(
      worker.workerSecurityGroup,
      new ec2.Port({
        protocol: ec2.Protocol.TCP,
        stringRepresentation: 'Master to Worker 50000',
        fromPort: 50000,
        toPort: 50000
      })
    );
    jenkinsMasterService.connections.allowFrom(
      worker.workerSecurityGroup,
      new ec2.Port({
        protocol: ec2.Protocol.TCP,
        stringRepresentation: 'Master to Worker 8080',
        fromPort: 8080,
        toPort: 8080
      })
    );

    // Fargate: TaskDefinition
    const jenkinsMasterTask = jenkinsMasterService.taskDefinition;
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
