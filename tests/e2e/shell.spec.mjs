import {test,expect} from '@playwright/test';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
let server,url;
test.beforeAll(async()=>{
 server=http.createServer(async(req,res)=>{
  const name=req.url==='/'?'index.html':req.url==='/style.css'?'style.css':null;
  if(!name){res.writeHead(404);res.end();return;}
  try {res.setHeader('Content-Type',name.endsWith('css')?'text/css':'text/html');res.end(await readFile(new URL('../../web/'+name,import.meta.url)));}
  catch(e){if(e.code!=='ENOENT')throw e;res.writeHead(404);res.end('<!doctype html><title>not implemented</title>');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(r=>server.close(r));});
for(const width of [1440,768,375])test(`Korean lobby controls fit at ${width}px`,async({page})=>{
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.setViewportSize({width,height:900});await page.goto(url);
 await expect(page.getByRole('heading',{name:'CROSSYARD',exact:true})).toBeVisible({timeout:1500});
 if(width===375)await expect(page.locator('.description')).toContainText('쏘세요. 친구');
 if(width===1440)expect(await page.locator('.map-label').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(17, 25, 25)');
 await expect(page.getByLabel('닉네임',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'새 방 만들기',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('#code-help').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14);
});
