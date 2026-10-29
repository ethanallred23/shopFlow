import {beforeAll,expect,it} from 'vitest';
import express from 'express';
import request from 'supertest';

let trusted:any;
beforeAll(async()=>{
 process.env.NODE_ENV='test';
 const {app}=await import('../server/index');
 trusted=app.get('trust proxy fn');
});
it('trusts only loopback peers for forwarded client IPs',async()=>{
 expect(trusted('127.0.0.1',0)).toBe(true);
 expect(trusted('::1',0)).toBe(true);
 expect(trusted('203.0.113.20',0)).toBe(false);
 const probe=express();probe.set('trust proxy',trusted);
 probe.get('/',(req,res)=>res.json({ip:req.ip}));
 // The proxy appends the real client to any client-supplied header.
 const result=await request(probe).get('/').set('X-Forwarded-For','198.51.100.99, 203.0.113.20');
 expect(result.body.ip).toBe('203.0.113.20');
});
