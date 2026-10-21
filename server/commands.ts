import {Prisma} from '@prisma/client';
import {HttpError} from './ingestion';

export async function expireCommands(tx:Prisma.TransactionClient,deviceId:string){
  await tx.deviceCommand.updateMany({where:{deviceId,status:'pending',expiresAt:{lte:new Date()}},data:{status:'expired'}});
}

export async function acknowledgeCommand(tx:Prisma.TransactionClient,deviceId:string,id:string,body:{status:'applied'|'rejected';result?:Record<string,unknown>;error?:string}){
  const command=await tx.deviceCommand.findFirst({where:{id,deviceId}});
  if(!command)throw new HttpError(404,'Command not found');
  if(command.status==='applied'||command.status==='rejected'){
    if(command.status!==body.status)throw new HttpError(409,'Command already acknowledged with a different status');
    return {ok:true,duplicate:true,status:command.status};
  }
  // An ACK may have been lost after execution. Expiry stops delivery, but must
  // not discard a later device report of what actually happened.
  await tx.deviceCommand.update({where:{id},data:{status:body.status,acknowledgedAt:new Date(),result:body.result as Prisma.InputJsonValue|undefined,error:body.error}});
  return {ok:true,duplicate:false,status:body.status};
}
