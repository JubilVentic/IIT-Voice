// Run with Playwright available in NODE_PATH. Uses disposable data, not the demo database.
const {chromium} = require('playwright');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iit-voice-browser-'));
const env = {...process.env, IIT_VOICE_DATA: temp, PYTHONUNBUFFERED: '1', GEMINI_API_KEY:'browser-test-key', IIT_VOICE_DEMO_LOGIN:'1'};
const python = process.env.IIT_VOICE_PYTHON || 'python3';
async function freePort() {return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
(async()=>{
  let service, browser;
  try {
    const seed = spawnSync(python, ['-B','server.py','--seed-demo'], {cwd:root, env, encoding:'utf8'});
    assert.equal(seed.status, 0, seed.stderr);
    const password = seed.stdout.match(/accounts: (.+)/)[1].trim();
    const port = await freePort();
    service = spawn(python, ['-B','-c',`import base64, io
from PIL import Image
import server
def screen(image):
    # Harmless solid-color fixtures simulate verdicts; never use explicit photos.
    rgb = Image.open(io.BytesIO(base64.b64decode(image))).getpixel((0,0))
    if rgb[0] > 200 and rgb[1] < 30:
        return {'category':None,'title':None,'reason':'','screening':{'status':'rejected','reason':'Fixture: content blocked.'}}
    if rgb[2] > 200 and rgb[0] < 30:
        return {'category':None,'title':None,'reason':'','screening':{'status':'needs_review','reason':'Fixture: relevance unclear.'}}
    return {'category':'Facilities, Infrastructure & Maintenance','categories':['Facilities, Infrastructure & Maintenance','Safety, Security & Risk'],'title':'Damaged classroom chair','description':'A classroom chair has visible damage and requires inspection.','reason':'Fixture: damaged equipment.','screening':{'status':'appropriate','reason':'Fixture: campus equipment.'}}
server.suggest_category = screen
server.main()`, '--port',String(port)], {cwd:root, env, stdio:'ignore'});
    const base = `http://127.0.0.1:${port}`;
    for(let i=0;i<40;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
    browser = await chromium.launch({headless:true, ...(process.env.IIT_VOICE_BROWSER_CHANNEL ? {channel:process.env.IIT_VOICE_BROWSER_CHANNEL} : {})});
    const page = await browser.newPage({viewport:{width:1360,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    async function login(email){await page.goto(base);await page.locator('[name=email]').fill(email);await page.locator('[name=password]').fill(password);await page.getByRole('button',{name:'Sign in →',exact:true}).click();await page.locator('.stats').waitFor();}
    async function logout(){await page.locator('.sidebar [data-logout]').click();await page.locator('#auth-form').waitFor();}
    await page.goto(base);
    await page.locator('.demo-accounts').waitFor();
    assert.equal(await page.locator('[data-demo-account]').count(),4);
    await page.screenshot({path:path.join(root,'test-results/demo-accounts.png'),fullPage:true});
    for (const [label, role] of [['Main Admin','Main Admin'],['Validator Admin','Validator Admin'],['Student','Campus member'],['Faculty','Campus member']]) {
      await page.locator('.demo-accounts').getByRole('button',{name:new RegExp('^'+label+' ')}).click();
      await page.locator('.stats').waitFor();
      assert.equal(await page.locator('.account small').innerText(),role);
      await logout();await page.locator('.demo-accounts').waitFor();
    }
    await login('admin@iitvoice.local');
    await page.screenshot({path:path.join(root,'test-results/main-admin.png'),fullPage:true});
    await page.locator('.sidebar [data-page=users]').click();await page.locator('table').waitFor();assert.equal(await page.locator('tbody tr').count(),4);
    await page.locator('.sidebar [data-page=routing]').click();await page.locator('.routing-form').first().waitFor();assert.equal(await page.locator('.routing-form').count(),9);
    await logout();
    await login('student@iitvoice.local');
    assert.match(await page.locator('.campus-embed').getAttribute('src'), /^https:\/\/www\.google\.com\/maps\/embed\?pb=/);
    await page.getByRole('button',{name:'Report pins',exact:true}).click();
    await page.locator('.leaflet-tile-loaded').first().waitFor({timeout:20000});
    assert.equal(await page.locator('.map-pin').count(),2);
    await page.getByRole('button',{name:'Google campus map',exact:true}).click();
    await page.locator('.campus-embed').waitFor();
    assert.equal(await page.locator('.leaflet-container').count(),0);
    await page.getByRole('button',{name:'Report pins',exact:true}).click();
    await page.locator('.leaflet-tile-loaded').first().waitFor({timeout:20000});
    assert.equal(await page.locator('[data-page=users]').count(),0);
    const denied=await page.evaluate(async()=>{const r=await fetch('/api/admin/users');return r.status;});assert.equal(denied,403);
    await page.screenshot({path:path.join(root,'test-results/student.png'),fullPage:true});
    await page.locator('[data-new]').click();await page.locator('#report-form').waitFor();
    assert.equal(await page.locator('#report-form [name=priority]').count(),0);
    await page.locator('#report-form [name=category]').selectOption('Safety, Security & Risk');
    assert.equal(await page.locator('#report-form [name=categories]:checked').count(),1,'Replacing a lone default category must not add an unsupported extra');
    assert.equal((await page.locator('#pick-map').boundingBox()).height,460);
    const fixture = spawnSync(python, ['-B','-c', "import sys; sys.path.insert(0, 'tests'); from test_photo_analysis import sample_photo; print(sample_photo({1:'N',2:(8,14,30),3:'E',4:(124,14,38)}))"], {cwd:root,env,encoding:'utf8'});
    assert.equal(fixture.status,0,fixture.stderr);
    const photo = path.join(temp,'photo.jpg'); fs.writeFileSync(photo,Buffer.from(fixture.stdout.trim(),'base64'));
    const coloredPhoto = color => {
      const result = spawnSync(python, ['-B','-c', `import sys; sys.path.insert(0,'tests'); from test_photo_analysis import sample_photo; print(sample_photo(color='${color}'))`], {cwd:root,env,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      const filename=path.join(temp,`${color}.jpg`);fs.writeFileSync(filename,Buffer.from(result.stdout.trim(),'base64'));return filename;
    };
    const blockedFixture=coloredPhoto('red'), reviewFixture=coloredPhoto('blue');
    // The test server mocks Gemini; EXIF parsing and saved analysis use the real API.
    await page.locator('#report-form [name=title]').fill('Draft must survive file picker cancellation');
    await page.locator('#report-form [name=image]').dispatchEvent('cancel',{bubbles:true});
    assert.equal(await page.locator('#report-form').count(),1);
    assert.equal(await page.locator('#report-form [name=title]').inputValue(),'Draft must survive file picker cancellation');
    await page.locator('#report-form [name=image]').setInputFiles(blockedFixture);
    await page.locator('#report-form .photo-screening.rejected').waitFor();
    assert.equal(await page.getByRole('button',{name:'Submit for validation',exact:true}).isDisabled(),true);
    assert.equal(await page.locator('.photo-preview').count(),0,'Blocked image must not be previewed');
    await page.getByRole('button',{name:'Remove photo',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Submit for validation',exact:true}).isDisabled(),false);
    await page.locator('#report-form [name=image]').setInputFiles(photo);
    await page.getByRole('button',{name:'Use photo geotag',exact:true}).click();
    assert.equal(await page.locator('#report-form [name=categories][value="Safety, Security & Risk"]').isChecked(),true,'AI must check supported additional categories automatically');
    assert.equal(await page.locator('#report-form .category-selection').evaluate(details=>details.open),true,'AI-selected extras should be expanded for review');
    await page.locator('#report-form .category-selection summary').getByText('Additional categories · 1 selected',{exact:true}).waitFor();
    assert.match(await page.locator('#pin-label').innerText(),/8\.24167/);
    assert.equal(await page.locator('#report-form [name=description]').inputValue(),'A classroom chair has visible damage and requires inspection.');
    await page.locator('#report-form [name=description]').fill('My edited observation must survive another analysis.');
    const retryResponse = page.waitForResponse(response=>response.url().endsWith('/api/photos/inspect') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Check photo again',exact:true}).click();
    await retryResponse;
    await page.waitForFunction(()=>!document.querySelector('#report-form [name=category]').disabled && !document.querySelector('.photo-assist').textContent.includes('Screening photo and suggesting'));
    await page.waitForFunction(()=>document.querySelector('#report-form [name=category]').value==='Facilities, Infrastructure & Maintenance');
    assert.equal(await page.locator('#report-form [name=description]').inputValue(),'My edited observation must survive another analysis.');
    await page.getByRole('button',{name:'Use AI description draft',exact:true}).click();
    assert.equal(await page.locator('#report-form [name=description]').inputValue(),'A classroom chair has visible damage and requires inspection.');
    await page.locator('#report-form [name=category]').selectOption('Safety, Security & Risk');
    assert.equal(await page.locator('#report-form [name=categories][value="Facilities, Infrastructure & Maintenance"]').isChecked(),true,'Changing primary must preserve the previous AI-selected category');
    await page.locator('#report-form [name=categories][value="Facilities, Infrastructure & Maintenance"]').uncheck();
    assert.equal(await page.locator('#report-form [name=categories][value="Facilities, Infrastructure & Maintenance"]').isChecked(),false,'AI category suggestions must remain editable');
    await page.locator('#report-form [name=categories][value="Facilities, Infrastructure & Maintenance"]').check();
    await page.locator('#report-form [name=categories][value="ICT, Internet & Digital Services"]').check();
    assert.equal(await page.locator('#report-form [name=title]').inputValue(),'Damaged classroom chair');
    assert.equal(await page.locator('#report-form [name=category]').inputValue(),'Safety, Security & Risk');
    await page.locator('#pick-map .leaflet-control-zoom-in').click();
    await page.waitForTimeout(300);
    await page.locator('#pick-map .leaflet-control-zoom-in').click();
    await page.locator('#pick-map img.leaflet-tile-loaded[src*="/18/"]').first().waitFor();
    const tileZoom = () => page.locator('#pick-map .leaflet-tile-loaded').evaluateAll(tiles => Math.max(...tiles.map(tile => Number(new URL(tile.src).pathname.split('/')[1]))));
    const selectedZoom = await tileZoom();
    await page.context().setGeolocation({latitude:8.24175844,longitude:124.24389112,accuracy:10});
    await page.context().grantPermissions(['geolocation'], {origin:base});
    await page.getByRole('button',{name:'Use current location',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#report-form [name=location]').value==='COE Building');
    await page.waitForTimeout(500);
    assert.equal(await tileZoom(),selectedZoom,'Current location must preserve the chosen zoom');
    const beforeDrag = await page.locator('#pin-label').innerText();
    const marker = await page.locator('#pick-map .leaflet-marker-icon').boundingBox();
    await page.mouse.move(marker.x+marker.width/2,marker.y+marker.height/2);
    await page.mouse.down(); await page.mouse.move(marker.x+marker.width/2+60,marker.y+marker.height/2+25,{steps:12}); await page.mouse.up();
    await page.waitForFunction(previous=>document.querySelector('#pin-label').textContent!==previous,beforeDrag);
    await page.locator('#report-form [name=location_details]').fill('2nd floor, Room 204, beside the stairs');
    await page.locator('#pick-map').click({position:{x:120,y:100}});
    assert.equal(await page.locator('#pick-map .leaflet-marker-icon.pin-glide').count(),1);
    assert.equal(await page.locator('#pick-map .leaflet-marker-icon').evaluate(el=>getComputedStyle(el).transitionDuration),'0.28s');
    await page.waitForFunction(()=>document.querySelector('#report-form [name=location]').value.length>0);
    await page.locator('#clear-pin').click();
    assert.equal(await page.locator('#report-form [name=location]').inputValue(),'');
    await page.locator('#pick-map').click({position:{x:150,y:100}});
    await page.waitForFunction(()=>document.querySelector('#report-form [name=location]').value.length>0);
    await page.locator('#report-form [name=title]').fill('Browser test: broken library chair');
    await page.locator('#report-form [name=location]').fill('Library reading area');
    await page.locator('#report-form [name=description]').fill('A chair is broken near the reading area. Please inspect and repair it.');
    await page.getByRole('button',{name:'Submit for validation',exact:true}).click();
    await page.locator('#modal-title').filter({hasText:'Browser test: broken library chair'}).waitFor();
    await page.getByText('2nd floor, Room 204, beside the stairs',{exact:false}).waitFor();
    await page.locator('.evidence-card').getByText('photo.jpg',{exact:true}).waitFor();
    assert.equal(await page.locator('#modal .report-description').first().innerText(),'A chair is broken near the reading area. Please inspect and repair it.');
    await page.locator('.evidence-card').getByText('A classroom chair has visible damage and requires inspection.',{exact:false}).waitFor();
    await page.locator('.evidence-card').getByText('Damaged classroom chair',{exact:false}).waitFor();
    await page.locator('.evidence-card').getByText('Facilities, Infrastructure & Maintenance',{exact:false}).waitFor();
    await page.locator('.dialog-close').click();
    await logout();
    await login('validator@iitvoice.local');
    assert.equal(await page.locator('[data-page=users]').count(),0);
    await page.screenshot({path:path.join(root,'test-results/validator-admin.png'),fullPage:true});
    await page.locator('.sidebar [data-page=queue]').click();
    assert.equal(await page.locator('#filter-sort').inputValue(),'newest');
    const order = await page.locator('#report-results [data-report]').evaluateAll(buttons=>buttons.map(button=>Number(button.dataset.report)));
    assert.deepEqual(order,[...order].sort((a,b)=>b-a),'Latest submissions must appear first');
    for (const category of ['Safety, Security & Risk','Facilities, Infrastructure & Maintenance','ICT, Internet & Digital Services']) {
      await page.locator('#filter-category').selectOption(category);
      assert.equal(await page.locator('#report-results .list-row').filter({hasText:'Browser test: broken library chair'}).count(),1);
    }
    await page.locator('#filter-area').selectOption('Digital & Academic');
    assert.equal(await page.locator('#report-results .list-row').filter({hasText:'Browser test: broken library chair'}).count(),1);
    await page.locator('#filter-area').selectOption('Operations & Governance');
    assert.equal(await page.locator('#report-results .list-row').filter({hasText:'Browser test: broken library chair'}).count(),0);
    await page.locator('#filter-area').selectOption('');
    await page.screenshot({path:path.join(root,'test-results/category-filters.png'),fullPage:false});
    const row=page.locator('.list-row').filter({hasText:'Browser test: broken library chair'});await row.getByRole('button',{name:'View concern →'}).click();
    await page.locator('#review-form').waitFor();
    await page.locator('#review-form .category-selection summary').click();
    await page.locator('#review-form [name=categories][value="Student Needs & Learning Environment"]').check();
    await page.locator('.evidence-card').getByText('Damaged classroom chair',{exact:false}).waitFor();
    await page.screenshot({path:path.join(root,'test-results/validator-evidence-analysis.png'),fullPage:false});
    assert.equal(await page.locator('#review-form [name=priority][type=radio]').count(),4);
    await page.locator('#review-form [name=priority][value=urgent]').check();
    await page.locator('#review-form [name=status]').selectOption('validated');
    await page.locator('#review-form [name=visibility]').selectOption('campus');
    await page.locator('#review-form [name=public_title]').fill('Broken library chair');
    await page.locator('#review-form [name=public_summary]').fill('A broken library chair requires maintenance.');
    await page.locator('#review-form [name=note]').fill('Location and condition verified. Routed for repair.');
    await page.getByRole('button',{name:'Save decision',exact:true}).click();
    await page.getByRole('heading',{name:'Validation complete',exact:true}).waitFor();
    await page.locator('.details-card').getByText('Student Needs & Learning Environment',{exact:false}).waitFor();
    assert.equal(await page.locator('#modal .badge.priority.urgent').count(),1);
    await page.locator('.dialog-close').click();await logout();
    await login('admin@iitvoice.local');
    await page.locator('.sidebar [data-page=reports]').click();await page.locator('#search').fill('Browser test');
    await page.getByRole('button',{name:'View concern →'}).click();await page.locator('#review-form').waitFor();
    await page.locator('#review-form [name=status]').selectOption('resolved');await page.locator('#review-form [name=note]').fill('Chair replaced. Resolution checked.');await page.getByRole('button',{name:'Save decision',exact:true}).click();
    await page.locator('#review-form [name=status]').filter({has:page.locator('option[value=closed]')}).waitFor();
    await page.locator('.dialog-close').click();await logout();
    await login('student@iitvoice.local');
    await page.locator('[data-new]').click();await page.locator('#report-form').waitFor();
    await page.locator('#report-form [name=image]').setInputFiles(reviewFixture);
    await page.locator('#report-form .photo-screening.needs_review').waitFor();
    assert.equal(await page.locator('.photo-preview').count(),0);
    await page.locator('#report-form [name=title]').fill('Questionable evidence fixture');
    await page.locator('#report-form [name=location]').fill('Library');
    await page.locator('#report-form [name=description]').fill('This harmless blue test image requires manual review.');
    await page.getByRole('button',{name:'Submit for validation',exact:true}).click();
    await page.locator('.evidence-card .photo-screening.needs_review').waitFor();
    assert.equal(await page.locator('.evidence-card img').count(),0);
    await page.locator('.dialog-close').click();await logout();
    await login('validator@iitvoice.local');
    await page.locator('.sidebar [data-page=reports]').click();await page.locator('#search').fill('Questionable evidence fixture');
    await page.getByRole('button',{name:'View concern →'}).click();
    await page.locator('.evidence-card .photo-screening.needs_review').waitFor();
    assert.equal(await page.locator('.evidence-card img').count(),0,'Flagged image must not be fetched or shown automatically');
    await page.locator('.evidence-card').getByRole('button',{name:'Show photo for review',exact:true}).click();
    assert.equal(await page.locator('.evidence-card img').count(),1);
    await page.locator('.evidence-card').getByRole('button',{name:'Hide photo',exact:true}).click();
    assert.equal(await page.locator('.evidence-card img').count(),0);
    await page.screenshot({path:path.join(root,'test-results/validator-photo-screening.png'),fullPage:false});
    await page.locator('.dialog-close').click();await logout();
    await login('student@iitvoice.local');await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(200);
    await page.screenshot({path:path.join(root,'test-results/student-mobile.png'),fullPage:false});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);assert.equal(overflow,false,'Mobile layout overflow');
    assert.deepEqual(errors,[],'Browser JavaScript errors');
    console.log('Browser workflow passed: login, role isolation, report submission, validation, resolution, photo screening, concealed review, and mobile layout.');
  } finally {if(browser)await browser.close();if(service)service.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
