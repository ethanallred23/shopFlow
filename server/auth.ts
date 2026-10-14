import {Request,Response,NextFunction} from 'express';
import {db} from './db';
import {hash,HttpError} from './ingestion';
import {can} from './domain';
declare global {namespace Express {interface Request {auth?:{id:string;orgId:string;name:string;email:string;role:string};csrf?:string;sessionId?:string}}}
export function asyncRoute(fn:(req:Request,res:Response,next:NextFunction)=>Promise<any>){return (req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res,next)).catch(next);};}
export const auth=asyncRoute(async(req,res,next)=>{
  const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('sf_session='))?.slice(11);
  if(!token)throw new HttpError(401,'Sign in to continue');
  const session=await db.session.findUnique({where:{id:hash(token)}});
  if(!session || session.expiresAt<new Date())throw new HttpError(401,'Session expired');
  const user=await db.user.findUnique({where:{id:session.userId}});
  if(!user)throw new HttpError(401,'Account unavailable');
  req.auth=user;req.csrf=session.csrf;req.sessionId=session.id;
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    if(req.headers['x-csrf-token']!==session.csrf || req.headers.origin!==process.env.APP_ORIGIN)throw new HttpError(403,'Invalid request origin or CSRF token');
  }
  next();
});
export const role=(required:'viewer'|'supervisor'|'admin')=>(req:Request,_res:Response,next:NextFunction)=>can(req.auth?.role??'',required)?next():next(new HttpError(403,'Insufficient role'));
export async function owned(model:'device'|'workstation'|'area'|'shop',id:string,orgId:string){
  const row=await (db[model] as any).findFirst({where:{id,orgId}});
  if(!row)throw new HttpError(404,'Record not found');return row;
}
