import { expect as expectCDK, haveResource } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import { Network } from '../lib/network';

test('Vpc Created', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new Network(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(haveResource("AWS::Vpc",{
      cidr: '10.0.0.0/24'
    }));
});
