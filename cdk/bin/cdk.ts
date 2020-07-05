#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { Network } from  '../lib/network';
import { Ecs } from  '../lib/ecs';
import { JenkinsMaster } from  '../lib/jenkins-master';
import { JenkinsWorker } from  '../lib/jenkins-worker';

const baseStackName = 'Jenkins';
const serviceDiscoveryNamespace = 'jenkins';

const app = new cdk.App();
const network = new Network(app, `${baseStackName}Network`);
const ecsCluster = new Ecs(app, `${baseStackName}Ecs`, {
  vpc: network.vpc,
  serviceDiscoveryNamespace: serviceDiscoveryNamespace
});

const jenkinsWorker = new JenkinsWorker(app, `${baseStackName}Worker`, {
  vpc: network.vpc,
});
new JenkinsMaster(app, `${baseStackName}Master`, {
  ecsCluster: ecsCluster,
  network: network,
  worker: jenkinsWorker,
});


app.synth();
