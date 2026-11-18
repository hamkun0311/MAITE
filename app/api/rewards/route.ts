import {z} from "zod";
import {AccountError,requireAccount} from "../../../lib/server/account.ts";
import {allowedOrigin,corsHeaders,preflight,readTextBounded} from "../../../lib/server/http.ts";
export const OPTIONS=preflight;
const day=z.iso.date();
async function handle(request:Request){
 const headers=corsHeaders(request);
 try{
  if(!allowedOrigin(request))throw new AccountError("허용되지 않은 요청입니다.",403);
  const {db,user}=await requireAccount(request);
  let name:string,args:Record<string,unknown>;
  if(request.method==="GET"){
   const month=day.parse(new URL(request.url).searchParams.get("month"));
   name="reward_calendar";args={p_user:user.id,p_month:month};
  }else{
   const input=z.object({kind:z.enum(["attendance","pass"]),day}).strict().parse(JSON.parse(await readTextBounded(request,2000)));
   name="claim_reward";args={p_user:user.id,p_kind:input.kind,p_day:input.day};
  }
  const {data,error}=await db.rpc(name,args);
  if(error){
   if(error.code==="PGRST202"||error.code==="42P01")throw new AccountError("보상 기능 DB 업데이트가 필요합니다.",503);
   const messages:Record<string,string>={attendance_expired:"출석 보상은 오늘 날짜만 받을 수 있어요.",no_pass_reward:"해당 날짜에 받을 패스 보상이 없어요.",invalid_reward_day:"아직 보상을 받을 수 없는 날짜예요."};
   throw new AccountError(messages[error.message]??"보상을 확인하지 못했습니다.",409);
  }
  return Response.json(data,{headers});
 }catch(error){return Response.json({error:error instanceof AccountError?error.message:"날짜와 요청을 확인해주세요."},{status:error instanceof AccountError?error.status:400,headers});}
}
export const GET=handle;
export const POST=handle;
