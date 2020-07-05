import * as sd from '@aws-cdk/aws-servicediscovery';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as cdk from '@aws-cdk/core';

interface EcsProps extends cdk.StackProps {
  vpc: ec2.IVpc,
  serviceDiscoveryNamespace: string,
}

export class Ecs extends cdk.Stack {
  public readonly cluster: ecs.ICluster;

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
  }
}
