import 'dotenv/config';
import bcrypt from 'bcryptjs';
import {DateTime} from 'luxon';
import {db} from '../server/db';
const name=process.env.ORG_NAME,timezone=process.env.ORG_TIMEZONE??'America/Denver',email=process.env.SEED_EMAIL,password=process.env.SEED_PASSWORD;
if(!name||!email||!password||password.length<12||!DateTime.now().setZone(timezone).isValid)throw new Error('Set ORG_NAME, valid ORG_TIMEZONE, SEED_EMAIL, and SEED_PASSWORD (12+ characters).');
try{
 const passwordHash=await bcrypt.hash(password,12);
 await db.$transaction(async tx=>{const org=await tx.organization.create({data:{name,timezone,demo:false}});await tx.user.create({data:{orgId:org.id,email:email.toLowerCase(),name:'Administrator',passwordHash,role:'admin'}});await tx.shift.create({data:{orgId:org.id,name:'Day shift',startMinute:360,endMinute:840,breaks:[]}});});
 console.log('Production organization and administrator created. Add floor structure in Settings. No demo records were created.');
}finally{await db.$disconnect();}
