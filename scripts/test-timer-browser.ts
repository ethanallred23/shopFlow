import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5189','--strictPort'],{stdio:'ignore'});
const base='http://127.0.0.1:5189';
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage();
 page.on("pageerror",e=>console.error("Browser error:",e.message));
 page.on("console",m=>{if(m.type()==="error")console.error(m.text());});
 let command:any=null,failRead=false,failSend=false;
 await page.route('**/api/**',async route=>{
  const req=route.request();
  if(req.url().endsWith('/api/me'))return route.fulfill({json:{csrf:'test'}});
  if(req.method()==='POST'){
   if(failSend)return route.abort('connectionfailed');
   command={id:'test-command',type:req.postDataJSON().type,status:'pending'};
   return route.fulfill({status:201,json:command});
  }
  if(failRead)return route.abort('connectionfailed');
  return route.fulfill({json:req.url().endsWith('/commands')?(command?[command]:[]):command});
 });
 await page.route('**/__timer-test',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">
 import RefreshRuntime from '/@react-refresh';
 RefreshRuntime.injectIntoGlobalHook(window);
 window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
 window.__vite_plugin_react_preamble_installed__ = true;
 const React=(await import('/node_modules/.vite/deps/react.js')).default;
 const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
 const {DetectionTimers}=await import('/src/DetectionTimers.tsx');
 createRoot(document.getElementById('root')).render(React.createElement(DetectionTimers,{canControl:true,status:'online',zone:'UTC',timers:[{deviceId:'test',detected:true,snapshotFresh:true,currentCounterMs:0,recoveredTotalMs:0,confirmedShiftMs:0,unallocatedAllTimeMs:0,notices:[]}]}));
 </script>`}));
 await page.goto(base+'/__timer-test');
 const pause=page.getByRole('button',{name:'Pause',exact:true});
 await expect(pause).toBeEnabled();
 for(const label of ['Pause','Resume','Reset','Send']){
  if(label==='Send')await page.getByRole('spinbutton').fill('60000');
  await page.getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByRole('status').last()).toContainText('Queued');await expect(pause).toBeDisabled();
  command.status='applied';await expect(page.getByRole('status').last()).toContainText('Applied by Arduino',{timeout:6000});await expect(pause).toBeEnabled();
 }
 await pause.click();await expect(page.getByRole('status').last()).toContainText('Queued');command.status='rejected';command.error='Expired before application';
 await expect(page.getByRole('status').last()).toContainText('Rejected by Arduino',{timeout:6000});await expect(pause).toBeEnabled();
 await pause.click();await expect(page.getByRole('status').last()).toContainText('Queued');command.status='expired';
 await expect(page.getByRole('status').last()).toContainText('execution is unconfirmed',{timeout:6000});await expect(pause).toBeEnabled();
 failRead=true;await expect(page.getByRole('alert')).toContainText('Cannot verify device execution',{timeout:6000});
 failRead=false;await expect(page.getByRole('alert')).toHaveCount(0,{timeout:6000});
 failSend=true;await pause.click();await expect(page.getByRole('alert')).toContainText('Execution is unconfirmed');await expect(pause).toBeEnabled();
 console.log('Browser timer controls passed: four controls, pending/applied/rejected/expired, network loss, recovery, failed submission.');
}finally{await browser?.close();server.kill();}
