import * as sd from '@aws-cdk/aws-servicediscovery';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as autoscaling from '@aws-cdk/aws-autoscaling';
import * as efs from '@aws-cdk/aws-efs';
import * as cdk from '@aws-cdk/core';

interface EcsProps extends cdk.StackProps {
  vpc: ec2.IVpc,
  serviceDiscoveryNamespace: string,
}

export class Ecs extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly asg: autoscaling.AutoScalingGroup;
  public readonly efsSecGrp: ec2.SecurityGroup;
  public readonly efsFilesystem: efs.CfnFileSystem;

  constructor(scope: cdk.App, id: string, props: EcsProps) {
    super(scope, id, props);

    const serviceDiscoveryNamespace = props.serviceDiscoveryNamespace;
    const vpc = props.vpc;

    /**
     * ECS Cluster
     */
    this.cluster = new ecs.Cluster(this, "EcsCluster", {
      clusterName: 'jenkins',
      vpc: vpc,
      defaultCloudMapNamespace: {
        name: serviceDiscoveryNamespace,
        type: sd.NamespaceType.DNS_PRIVATE,
      }
    });

    /**
     * EC2
     */
    const asg = this.cluster.addCapacity("Ec2", {
      instanceType: new ec2.InstanceType('t3.xlarge'),
      keyName: "jenkinsonaws",
    });

    const efsSecGrp = new ec2.SecurityGroup(this, "EFSSecGrp", {
      vpc: vpc,
      allowAllOutbound: true,
    })
    efsSecGrp.addIngressRule(
      this.cluster.connections.securityGroups[0],
      new ec2.Port({
        protocol: ec2.Protocol.ALL,
        stringRepresentation: "ALL",
        fromPort: 2049,
        toPort: 2049,
      }),
      "EFS"
    );

    const efsFilesystem = new efs.CfnFileSystem(this, "EFSBackend");
    vpc.privateSubnets.forEach((subnet, idx) => {
      new efs.CfnMountTarget(this, `EFS${idx}`, {
        fileSystemId: efsFilesystem.ref,
        subnetId: subnet.subnetId,
        securityGroups: [efsSecGrp.securityGroupId]
      });
    });

    const userData = `
sudo yum install -y amazon-efs-utils
sudo mkdir /mnt/efs
sudo chown -R ec2-user: /mnt/efs
sudo chmod -R 0777 /mnt/efs
sudo mount -t efs -o tls /mnt/efs ${efsFilesystem.ref}:/ efs`;
    asg.addUserData(userData);
  }
}
