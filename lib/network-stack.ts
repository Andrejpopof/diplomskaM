import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import {Duration} from "aws-cdk-lib";

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class NetworkStack extends cdk.Stack {

  public readonly myVpc : ec2.Vpc;
  private readonly ipAddresses : ec2.IpAddresses
  private readonly alb : elbv2.ApplicationLoadBalancer;
  private readonly cluster : ecs.Cluster;
  private readonly nlb : elbv2.NetworkLoadBalancer;
  private networkLoadBalancerTG: elbv2.NetworkTargetGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    this.myVpc = new ec2.Vpc(this,'myVpc', {
      availabilityZones: ["eu-central-1a", "eu-central-1b"],
      ipAddresses: ec2.IpAddresses.cidr('10.172.0.0/22'),
      natGateways: 0,
      subnetConfiguration:[
        {
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask:26,
          name: 'PublicSubnet'
        },
        {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask:26,
          name: 'IsolatedSubnet'
        }
      ]
    })
    // Tagiranje na public subnets
    for (const subnet of this.myVpc.publicSubnets){
      cdk.Aspects.of(subnet).add(new cdk.Tag(
          'Name',
          `${this.myVpc.node.id}-${subnet.node.id.replace(/Subnet[0-9]$/, '')}-${subnet.availabilityZone}`
      ))
    }
    // Tagiranje na private subnets
    for (const subnet of this.myVpc.isolatedSubnets){
      cdk.Aspects.of(subnet).add(new cdk.Tag(
          'Name',
          `${this.myVpc.node.id}-${subnet.node.id.replace(/Subnet[0-9]$/,'')}-${subnet.availabilityZone}`
      ))
    }

    //ALB configuration
    const albSG = new ec2.SecurityGroup(this,'albSG',{
      vpc: this.myVpc,
      description: 'Security group for the application load balancer',
      allowAllOutbound: true
    });
    albSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic from anywhere');

    this.alb = new elbv2.ApplicationLoadBalancer(this,'ApplicationLoadBalancer',{
      vpc: this.myVpc,
      internetFacing: true,
      securityGroup: albSG,
    });

    //Nlb configuration
    this.nlb = new elbv2.NetworkLoadBalancer(this,"myNLB",{
      vpc : this.myVpc,
      deletionProtection: false,
      vpcSubnets: {subnetType: ec2.SubnetType.PUBLIC}
    })

    this.networkLoadBalancerTG = new elbv2.NetworkTargetGroup(this,'NetworkTargetGroup',{
      vpc: this.myVpc,
      port: 5432,
      targetType: elbv2.TargetType.IP,
      protocol: elbv2.Protocol.TCP,
      healthCheck: {
        enabled: true,
        healthyThresholdCount: 3,
        timeout: Duration.seconds(10),
        protocol: elbv2.Protocol.TCP,
        port: '5432',
        unhealthyThresholdCount: 3,
      }
    });

    const networkLBListener = new elbv2.NetworkListener(this,'NetworkLBListener',{
      port: 5432,
      protocol: elbv2.Protocol.TCP,
      loadBalancer: this.nlb,
      defaultAction: elbv2.NetworkListenerAction.forward([this.networkLoadBalancerTG])
    });

    this.cluster = new ecs.Cluster(this, "myCluster", {
      vpc: this.myVpc,
    })
  }
}
