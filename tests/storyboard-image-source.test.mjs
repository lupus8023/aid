import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadStoryboardImage, storyboardImageFetchUrl, isStoredStoryboardSource } from '../lib/storyboardImageSource.ts';
test('APIMart generated frames use same-origin reads without replacing source identities', () => {
 const url='https://getapib.org/f/image/paid-frame.png';
 assert.equal(storyboardImageFetchUrl(url), '/api/storyboard-image?url='+encodeURIComponent(url));
 assert.equal(storyboardImageFetchUrl('https://res.cloudinary.com/test.jpg'),'https://res.cloudinary.com/test.jpg');
 assert.equal(storyboardImageFetchUrl('data:image/png;base64,fixture'),'data:image/png;base64,fixture');
});
test('frame proxy returns original bytes and does not follow redirects to arbitrary networks', async () => {
 const bytes=Buffer.from('image-fixture');let calls=0;
 const result=await downloadStoryboardImage('https://getapib.org/frame.png', async(url,options)=>{calls++;assert.equal(options.redirect,'error');return new Response(bytes,{headers:{'content-type':'image/png'}});});
 assert.deepEqual(result.bytes,bytes); assert.equal(calls,1);
 for(const url of ['http://127.0.0.1/private','https://example.test/image','https://getapib.org:444/image','https://user:pass@getapib.org/image']){
  assert.equal(isStoredStoryboardSource(url),false);
  await assert.rejects(downloadStoryboardImage(url,async()=>assert.fail('must not fetch')),/域名/);
 }
 await assert.rejects(downloadStoryboardImage('https://getapib.org/a',async()=>new Response('html',{headers:{'content-type':'text/html'}})),/读取失败/);
 await assert.rejects(downloadStoryboardImage('https://getapib.org/a',async()=>new Response(bytes,{headers:{'content-type':'image/png','content-length':String(26*1024*1024)}})),/25MB/);
});

test('hosted frame responses preserve aspect ratio within H3 pixel and byte limits', async () => {
 const { default: sharp } = await import('sharp');
 const { fitStoryboardProxyImage } = await import('../lib/storyboardImageProxyServer.ts');
 const original=await sharp({create:{width:2160,height:3840,channels:3,background:'#badefa'}}).png().toBuffer();
 const snapshot=Buffer.from(original), result=await fitStoryboardProxyImage(original), meta=await sharp(result).metadata();
 assert.equal(meta.width,900);assert.equal(meta.height,1600);assert.equal(meta.format,'webp');assert.ok(result.length<=1600000);assert.deepEqual(original,snapshot);
});
