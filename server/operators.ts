import {db} from './db';
import {HttpError} from './ingestion';

type PersonChange={role?:'admin'|'supervisor'|'viewer';areaId?:string|null;workstationId?:string|null};

// Assignment changes serialize per shop so a person moving between stations and
// another operator taking their place cannot leave two open assignments.
export async function changePerson(orgId:string,userId:string,change:PersonChange,expectedStation?:string){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM Organization WHERE id = ${orgId} FOR UPDATE`;
  const person=await tx.user.findFirst({where:{id:userId,orgId}});
  if(!person)throw new HttpError(404,'User not found');
  if(expectedStation&&person.workstationId!==expectedStation)throw new HttpError(409,'User is no longer assigned to this workstation');
  if(change.areaId&&!await tx.area.findFirst({where:{id:change.areaId,orgId}}))throw new HttpError(404,'Department not found');
  const areaId=change.areaId===undefined?person.areaId:change.areaId;
  const workstationId=change.workstationId===undefined?(areaId!==person.areaId?null:person.workstationId):change.workstationId;
  if(workstationId){
   const station=await tx.workstation.findFirst({where:{id:workstationId,orgId}});
   if(!station)throw new HttpError(404,'Workstation not found');
   if(station.areaId!==areaId)throw new HttpError(400,'Workstation must be in the user department');
  }
  const at=new Date();
  if(workstationId!==person.workstationId){
   await tx.operatorAssignment.updateMany({where:{orgId,userId,endedAt:null},data:{endedAt:at}});
   if(workstationId){
    await tx.operatorAssignment.updateMany({where:{orgId,workstationId,endedAt:null},data:{endedAt:at}});
    await tx.user.updateMany({where:{orgId,workstationId,id:{not:userId}},data:{workstationId:null}});
   }
  }
  await tx.user.update({where:{id:userId},data:{...change,areaId,workstationId}});
  if(workstationId&&workstationId!==person.workstationId)await tx.operatorAssignment.create({data:{orgId,workstationId,userId,operatorName:person.name,startedAt:at}});
  return {ok:true};
 });
}
