import * as ec2 from '@aws-cdk/aws-ec2';
import * as cdk from '@aws-cdk/core';

export class Network extends cdk.Stack {
  public readonly vpc: ec2.IVpc;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * VPC
     */
    this.vpc = new ec2.Vpc(this, "Vpc", { cidr: '10.0.0.0/24' });
  }
}
