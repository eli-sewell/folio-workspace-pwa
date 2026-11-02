import {createClient} from 'npm:@supabase/supabase-js@2.118.0'
import webpush from 'npm:web-push@3.6.7'

Deno.serve(async request => {
  if (request.method !== 'POST' || !request.headers.has('x-folio-job')) return new Response(null,{status:403})
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const {data:config,error}=await db.from('folio_push_config').select('secret,keys').single()
  if(error) return new Response(null,{status:503})
  if(request.headers.get('x-folio-job')!==config.secret) return new Response(null,{status:403})
  if(!config.keys){
    await db.from('folio_push_config').update({keys:webpush.generateVAPIDKeys()}).eq('singleton',true).is('keys',null).throwOnError()
    return new Response('Initialized')
  }
  webpush.setVapidDetails('https://folio-workspace-pwa.netlify.app/',config.keys.publicKey,config.keys.privateKey)
  const {data:jobs}=await db.rpc('folio_claim_push').throwOnError()
  await Promise.all(jobs.map(async job=>{
    try {
      await webpush.sendNotification({endpoint:job.endpoint,keys:job.keys},JSON.stringify({title:job.title,id:job.reminder}),{TTL:86400,timeout:10000})
    } catch(e){
      if([404,410].includes(e.statusCode)) await db.from('folio_push_devices').delete().eq('id',job.device).throwOnError()
      else console.error('Push delivery failed',e.statusCode || 'network')
      return
    }
    await db.from('folio_push_sent').update({retry_at:'infinity'}).match({device:job.device,reminder:job.reminder,due:job.due}).throwOnError()
  }))
  return Response.json({processed:jobs.length})
})
