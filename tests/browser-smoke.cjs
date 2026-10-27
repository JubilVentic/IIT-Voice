// Run with Playwright available in NODE_PATH. Uses disposable data, not the demo database.
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iit-voice-browser-'));
const env = {
  ...process.env,
  IIT_VOICE_DATA: temp,
  DATABASE_URL: '',
  PYTHONUNBUFFERED: '1',
  GEMINI_API_KEY: 'browser-test-key',
  IIT_VOICE_DEMO_LOGIN: '1',
};
const python = process.env.IIT_VOICE_PYTHON || 'python3';
async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
(async () => {
  let service, browser;
  try {
    const seed = spawnSync(python, ['-B', 'server.py', '--seed-demo'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    assert.equal(seed.status, 0, seed.stderr);
    const password = seed.stdout.match(/accounts: (.+)/)[1].trim();
    const port = await freePort();
    service = spawn(
      python,
      [
        '-B',
        '-c',
        `import base64, io
from PIL import Image
import server
with server.connect() as connection:
    for account in connection.execute('SELECT id FROM users').fetchall():
        server.notify(connection, account['id'], None, 'Fixture: an update for this account only.')
def screen(image):
    # Harmless solid-color fixtures simulate verdicts; never use explicit photos.
    rgb = Image.open(io.BytesIO(base64.b64decode(image))).getpixel((0,0))
    if rgb[0] > 200 and rgb[1] < 30:
        return {'category':None,'title':None,'reason':'','screening':{'status':'rejected','reason':'Fixture: content blocked.'}}
    if rgb[2] > 200 and rgb[0] < 30:
        return {'category':None,'title':None,'reason':'','screening':{'status':'needs_review','reason':'Fixture: relevance unclear.'}}
    return {'category':'Facilities, Infrastructure & Maintenance','categories':['Facilities, Infrastructure & Maintenance','Safety, Security & Risk'],'title':'Damaged classroom chair','description':'A classroom chair has visible damage and requires inspection.','reason':'Fixture: damaged equipment.','screening':{'status':'appropriate','reason':'Fixture: campus equipment.'}}
server.suggest_category = screen
def compare(image, before_images, concern):
    rgb = Image.open(io.BytesIO(base64.b64decode(image))).getpixel((0,0))
    if rgb[0] > 200 and rgb[1] > 200 and rgb[2] < 30:
        raise RuntimeError('Fixture: comparison unavailable.')
    if rgb[1] > 100 and rgb[0] < 30 and rgb[2] < 30:
        return {'status':'unrelated','reason':'Fixture: a web dashboard is unrelated to the reported damaged chair.'}
    if rgb[0] > 200 and 80 < rgb[1] < 200 and rgb[2] < 30:
        return {'status':'still_unresolved','reason':'Fixture: the damaged chair is still unrepaired.'}
    if rgb[0] > 80 and rgb[2] > 80 and rgb[1] < 30:
        return {'status':'unclear','reason':'Fixture: the repair is obscured.'}
    return {'status':'supports_completion','reason':'Fixture: the relevant chair repair is visibly supported.'}
server.assess_completion = compare
server.main()`,
        '--port',
        String(port),
      ],
      { cwd: root, env, stdio: 'ignore' }
    );
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 40; i++) {
      try {
        await fetch(base);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    browser = await chromium.launch({
      headless: true,
      ...(process.env.IIT_VOICE_BROWSER_CHANNEL
        ? { channel: process.env.IIT_VOICE_BROWSER_CHANNEL }
        : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
    const errors = [];
    const externalMaps = [];
    page.on('request', (request) => {
      if (/tile\.openstreetmap\.org|google\.com\/maps/.test(request.url()))
        externalMaps.push(request.url());
    });
    page.on('pageerror', (e) => errors.push(e.stack));
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    async function login(email) {
      await page.goto(base);
      await page.locator('[name=email]').fill(email);
      await page.locator('[name=password]').fill(password);
      await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
      await page.locator('.stats').waitFor();
    }
    async function logout() {
      await page.locator('.sidebar [data-logout]').click();
      await page.locator('#auth-form').waitFor();
    }
    async function checkNotifications(target) {
      const expected = await target.evaluate(async () => {
        const me = await (await fetch('/api/me')).json(),
          boot = await (await fetch('/api/bootstrap')).json();
        return {
          unread: boot.notifications.filter((n) => !n.is_read).length,
          own: boot.notifications.every((n) => n.user_id === me.user.id),
        };
      });
      assert.equal(expected.own, true, 'Notifications must belong to the signed-in account');
      assert.ok(expected.unread > 0, 'Each demo role should have its own unread update');
      const button = target.locator('.topbar .notification-trigger');
      assert.equal(
        await button.isVisible(),
        true,
        'The notification shortcut must be visible outside collapsed navigation'
      );
      assert.equal(
        await button.getAttribute('aria-label'),
        `Notifications, ${expected.unread} unread`
      );
      assert.equal(
        await button.locator('.notification-count').innerText(),
        expected.unread > 99 ? '99+' : String(expected.unread)
      );
      const bounds = await button.boundingBox();
      assert.ok(
        bounds.y >= 0 && bounds.y + bounds.height < 120,
        'Notifications must appear at the top of the workspace'
      );
    }
    await page.goto(base);
    await page.locator('.demo-accounts').waitFor();
    await page.route('**/api/login', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'The page could not be found' })
    );
    await page.locator('[name=email]').fill('offline@test.local');
    await page.locator('[name=password]').fill('disposable-browser-test-password');
    await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'The server is unavailable. Please try again shortly.' })
      .waitFor();
    await page.unroute('**/api/login');
    await page.locator('[name=email]').fill('');
    await page.locator('[name=password]').fill('');

    assert.equal(await page.locator('[data-demo-account]').count(), 6);
    await page.locator('.auth-campus-photo').evaluate((image) => image.decode());
    await page.screenshot({
      path: path.join(root, 'test-results/demo-accounts.png'),
      fullPage: true,
    });
    for (const [label, role] of [
      ['Main Admin', 'Main Admin'],
      ['Validator Admin', 'Validator Admin'],
      ['Student', 'Campus member'],
      ['Faculty', 'Campus member'],
    ]) {
      await page
        .locator('.demo-accounts')
        .getByRole('button', { name: new RegExp('^' + label + ' ') })
        .click();
      await page.locator('.stats').waitFor();
      assert.equal(await page.locator('.account small').innerText(), role);
      await checkNotifications(page);
      await logout();
      await page.locator('.demo-accounts').waitFor();
    }
    await login('admin@iitvoice.local');
    await page.locator('.report-analytics').waitFor();
    assert.deepEqual(await page.locator('.analytics-stats .stat strong').allTextContents(), [
      '4',
      '3',
      '1',
      '1',
    ]);
    const summaryFilters = page.getByRole('group', { name: 'Report summary filters', exact: true });
    const hotspotTotal = () =>
      page
        .locator('#campus-map .hotspot-marker')
        .evaluateAll((markers) =>
          markers.reduce((sum, marker) => sum + Number(marker.dataset.count), 0)
        );
    assert.equal(
      await hotspotTotal(),
      4,
      'All pinned reports must contribute to the concentration view'
    );
    await summaryFilters
      .getByLabel('Category', { exact: true })
      .selectOption('Facilities, Infrastructure & Maintenance');
    assert.equal(await page.locator('.analytics-stats .stat strong').first().innerText(), '1');
    assert.equal(await hotspotTotal(), 1, 'Category filtering must update the concentration map');
    await summaryFilters.getByLabel('Priority', { exact: true }).selectOption('urgent');
    await page
      .getByText(
        'No reports match this selection. Adjust or reset the filters to see report activity.',
        { exact: true }
      )
      .waitFor();
    assert.equal(await hotspotTotal(), 0, 'An empty selection must remove all hotspot markers');
    await page.getByRole('button', { name: 'Reset summary filters', exact: true }).click();
    await page.locator('.status-key-row').filter({ hasText: 'Under review' }).click();
    assert.equal(
      await summaryFilters.getByLabel('Status', { exact: true }).inputValue(),
      'submitted'
    );
    assert.equal(await page.locator('.analytics-stats .stat strong').first().innerText(), '2');
    await page.getByRole('button', { name: 'Reset summary filters', exact: true }).click();
    const workload = page
      .locator('.summary-grid > .panel')
      .filter({ has: page.getByRole('heading', { name: 'Office workload', exact: true }) });
    await workload.locator('.summary-bar').filter({ hasText: 'Physical Plant' }).click();
    assert.equal(
      await summaryFilters.getByLabel('Responsible office', { exact: true }).inputValue(),
      '2'
    );
    assert.equal(await page.locator('.analytics-stats .stat strong').first().innerText(), '1');
    await summaryFilters
      .getByLabel('Responsible office', { exact: true })
      .selectOption('unassigned');
    assert.equal(await page.locator('.analytics-stats .stat strong').first().innerText(), '0');
    await page.getByRole('button', { name: 'Reset summary filters', exact: true }).click();
    await summaryFilters.getByLabel('Submission period', { exact: true }).selectOption('custom');
    await page.getByLabel('Submitted from', { exact: true }).fill('2099-01-02');
    await page.getByLabel('Submitted through', { exact: true }).fill('2099-01-01');
    await page
      .getByText('The start date must be on or before the end date.', { exact: true })
      .waitFor();
    assert.equal(await page.locator('.analytics-stats .stat strong').first().innerText(), '0');
    const submittedDay = await page.evaluate(async () => {
      const boot = await (await fetch('/api/bootstrap')).json();
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Manila',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .formatToParts(new Date(boot.reports[0].created_at))
          .map((part) => [part.type, part.value])
      );
      return `${parts.year}-${parts.month}-${parts.day}`;
    });
    await page.getByLabel('Submitted from', { exact: true }).fill(submittedDay);
    await page.getByLabel('Submitted through', { exact: true }).fill(submittedDay);
    assert.equal(
      await page.locator('.analytics-stats .stat strong').first().innerText(),
      '4',
      'Date boundaries must include all same-day submissions'
    );
    await page.getByRole('button', { name: 'Reset summary filters', exact: true }).click();
    await page.getByRole('button', { name: 'Individual pins', exact: true }).click();
    assert.equal(await page.locator('#campus-map .report-marker').count(), 4);
    await page.getByRole('button', { name: 'Report concentration', exact: true }).click();
    await page.locator('#campus-map .hotspot-marker').first().click();
    await page.locator('.leaflet-popup').getByRole('button', { name: /^IV-/ }).first().click();
    await page.locator('#modal-title').waitFor();
    await page.locator('.dialog-close').click();
    await page
      .locator('.report-analytics > .summary-grid')
      .first()
      .screenshot({ path: path.join(root, 'test-results/admin-summary-charts.png') });
    await page.locator('#campus-map .leaflet-image-layer').first().waitFor({ timeout: 20000 });
    await page
      .locator('.report-analytics > .panel')
      .filter({ has: page.getByRole('heading', { name: 'Report hotspots', exact: true }) })
      .screenshot({ path: path.join(root, 'test-results/admin-report-hotspots.png') });
    await page.screenshot({ path: path.join(root, 'test-results/main-admin.png'), fullPage: true });
    await page
      .locator('.workspace-header')
      .screenshot({ path: path.join(root, 'test-results/notifications-desktop.png') });
    await page.locator('.sidebar [data-page=users]').click();
    await page.locator('table').waitFor();
    assert.equal(await page.locator('tbody tr').count(), 6);
    await page.locator('.sidebar [data-page=routing]').click();
    await page.locator('.routing-form').first().waitFor();
    assert.equal(await page.locator('.routing-form').count(), 9);
    await page.locator('.sidebar [data-page=map]').click();
    await page.getByRole('button', { name: 'Report pins', exact: true }).click();
    await page.locator('#campus-map .report-marker').first().waitFor();
    assert.equal(await page.locator('#campus-map .report-marker').count(), 4);
    await page.getByLabel('Color pins by', { exact: true }).selectOption('category');
    await page.getByLabel('Primary category legend', { exact: true }).waitFor();
    await page.locator('#campus-map .leaflet-image-layer').first().waitFor({ timeout: 20000 });
    await page
      .locator('main > .panel')
      .first()
      .screenshot({ path: path.join(root, 'test-results/category-map.png') });
    await logout();
    await login('student@iitvoice.local');
    assert.equal(await page.locator('.campus-embed').count(), 0);
    assert.match(
      await page.locator('#campus-map .leaflet-image-layer').getAttribute('src'),
      /tibanga-site-plan/
    );
    await page.getByRole('button', { name: 'Report pins', exact: true }).click();
    await page.locator('.leaflet-image-layer').first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.map-pin').count(), 2);
    assert.deepEqual((await page.locator('#campus-map .map-pin text').allTextContents()).sort(), [
      'H',
      'N',
    ]);
    await page.locator('#campus-map .leaflet-control-zoom-in').click();
    await page.waitForTimeout(350);
    const markerPositions = await page
      .locator('#campus-map .report-marker')
      .evaluateAll((markers) => markers.map((marker) => marker.style.transform));
    await page.getByLabel('Color pins by', { exact: true }).selectOption('category');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#campus-map .map-pin text')].every((text) =>
        /^\d$/.test(text.textContent)
      )
    );
    assert.deepEqual(
      await page
        .locator('#campus-map .report-marker')
        .evaluateAll((markers) => markers.map((marker) => marker.style.transform)),
      markerPositions,
      'Changing marker colors must preserve the current map zoom and view'
    );
    await page
      .getByLabel('Category', { exact: true })
      .selectOption('Facilities, Infrastructure & Maintenance');
    assert.equal(await page.locator('#campus-map .report-marker').count(), 1);
    await page.getByLabel('Priority', { exact: true }).selectOption('normal');
    await page.getByText('No pinned concerns match these filters.', { exact: true }).waitFor();
    assert.equal(await page.locator('#campus-map .report-marker').count(), 0);
    await page.getByRole('button', { name: 'Reset map filters', exact: true }).click();
    assert.equal(await page.locator('#campus-map .report-marker').count(), 2);
    await page.getByLabel('Status', { exact: true }).selectOption('in_progress');
    assert.equal(await page.locator('#campus-map .report-marker').count(), 1);
    await page.locator('#campus-map .report-marker').click();
    await page.locator('.leaflet-popup').getByText('Priority: High', { exact: true }).waitFor();
    await page.locator('.leaflet-popup-close-button').click();
    await page.getByRole('button', { name: 'Reset map filters', exact: true }).click();
    await page.getByRole('button', { name: 'Campus plan', exact: true }).click();
    await page.locator('#campus-map .leaflet-image-layer').waitFor();
    assert.equal(await page.locator('#campus-map .report-marker').count(), 0);
    await page.getByRole('button', { name: 'Report pins', exact: true }).click();
    await page.locator('.leaflet-image-layer').first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-page=users]').count(), 0);
    const denied = await page.evaluate(async () => {
      const r = await fetch('/api/admin/users');
      return r.status;
    });
    assert.equal(denied, 403);
    await page.screenshot({ path: path.join(root, 'test-results/student.png'), fullPage: true });
    await page.locator('[data-new]').click();
    await page.locator('#report-form').waitFor();
    await page.locator('#report-form [name=title]').click();
    assert.equal(
      await page.locator('#modal').count(),
      1,
      'Clicking inside the dialog must keep it open'
    );
    const modalBounds = await page.locator('#modal').boundingBox();
    await page.mouse.click(modalBounds.x + 4, modalBounds.y + 45);
    assert.equal(
      await page.locator('#modal').count(),
      1,
      'Dialog padding must not count as the backdrop'
    );
    await page.locator('#report-form [name=title]').hover();
    await page.mouse.down();
    await page.mouse.move(5, 5);
    await page.mouse.up();
    assert.equal(
      await page.locator('#modal').count(),
      1,
      'Dragging from inside to outside must not close the dialog'
    );
    await page.mouse.click(5, 5);
    assert.equal(
      await page.locator('#modal').count(),
      0,
      'Clicking the backdrop must close the dialog'
    );
    await page.locator('[data-new]').click();
    await page.locator('#report-form').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modal').count(), 0, 'Escape must still close the dialog');
    await page.locator('[data-new]').click();
    await page.locator('#report-form').waitFor();
    assert.equal(await page.locator('#report-form [name=priority]').count(), 0);
    await page.locator('#report-form [name=category]').selectOption('Safety, Security & Risk');
    assert.equal(
      await page.locator('#report-form [name=categories]:checked').count(),
      1,
      'Replacing a lone default category must not add an unsupported extra'
    );
    assert.equal((await page.locator('#pick-map').boundingBox()).height, 460);
    const fixture = spawnSync(
      python,
      [
        '-B',
        '-c',
        "import sys; sys.path.insert(0, 'tests'); from test_photo_analysis import sample_photo; print(sample_photo({1:'N',2:(8,14,30),3:'E',4:(124,14,38)}))",
      ],
      { cwd: root, env, encoding: 'utf8' }
    );
    assert.equal(fixture.status, 0, fixture.stderr);
    const photo = path.join(temp, 'photo.jpg');
    fs.writeFileSync(photo, Buffer.from(fixture.stdout.trim(), 'base64'));
    const coloredPhoto = (color) => {
      const result = spawnSync(
        python,
        [
          '-B',
          '-c',
          `import sys; sys.path.insert(0,'tests'); from test_photo_analysis import sample_photo; print(sample_photo(color='${color}'))`,
        ],
        { cwd: root, env, encoding: 'utf8' }
      );
      assert.equal(result.status, 0, result.stderr);
      const filename = path.join(temp, `${color}.jpg`);
      fs.writeFileSync(filename, Buffer.from(result.stdout.trim(), 'base64'));
      return filename;
    };
    const blockedFixture = coloredPhoto('red'),
      reviewFixture = coloredPhoto('blue');
    // The test server mocks Gemini; EXIF parsing and saved analysis use the real API.
    await page
      .locator('#report-form [name=title]')
      .fill('Draft must survive file picker cancellation');
    await page.locator('#report-form [name=image]').dispatchEvent('cancel', { bubbles: true });
    assert.equal(await page.locator('#report-form').count(), 1);
    assert.equal(
      await page.locator('#report-form [name=title]').inputValue(),
      'Draft must survive file picker cancellation'
    );
    await page.locator('#report-form [name=image]').setInputFiles(blockedFixture);
    await page.locator('#report-form .photo-screening.rejected').waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Submit for validation', exact: true }).isDisabled(),
      true
    );
    assert.equal(
      await page.locator('.photo-preview').count(),
      0,
      'Blocked image must not be previewed'
    );
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Submit for validation', exact: true }).isDisabled(),
      false
    );
    await page.locator('#report-form [name=image]').setInputFiles(photo);
    await page.getByRole('button', { name: 'Use photo geotag', exact: true }).click();
    assert.equal(
      await page
        .locator('#report-form [name=categories][value="Safety, Security & Risk"]')
        .isChecked(),
      true,
      'AI must check supported additional categories automatically'
    );
    assert.equal(
      await page.locator('#report-form .category-selection').evaluate((details) => details.open),
      true,
      'AI-selected extras should be expanded for review'
    );
    await page
      .locator('#report-form .category-selection summary')
      .getByText('Additional categories · 1 selected', { exact: true })
      .waitFor();
    assert.match(await page.locator('#pin-label').innerText(), /8\.24167/);
    assert.equal(
      await page.locator('#report-form [name=description]').inputValue(),
      'A classroom chair has visible damage and requires inspection.'
    );
    assert.equal(
      await page.locator('#description-recheck').count(),
      0,
      'An unchanged AI draft needs no edit prompt'
    );
    let editChecks = 0;
    const countChecks = (request) => {
      if (request.url().endsWith('/api/photos/inspect')) editChecks++;
    };
    page.on('request', countChecks);
    await page.locator('.description-editor').scrollIntoViewIfNeeded();
    await page
      .locator('#report-form [name=description]')
      .fill('My edited observation must survive another analysis.');
    const nearbyRetry = page
      .locator('#description-recheck')
      .getByRole('button', { name: 'Check photo again', exact: true });
    await nearbyRetry.waitFor();
    assert.equal(editChecks, 0, 'Editing text must not automatically send an AI request');
    const retryBounds = await nearbyRetry.boundingBox(),
      editModal = await page.locator('#modal').boundingBox();
    await page.screenshot({ path: path.join(root, 'test-results/description-recheck.png') });
    assert.ok(
      retryBounds.y >= editModal.y - 1 &&
        retryBounds.y + retryBounds.height <= editModal.y + editModal.height + 1,
      'The recheck shortcut must appear beside the edited description without scrolling to the photo: ' +
        JSON.stringify({ retryBounds, editModal })
    );
    const retryResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/photos/inspect') && response.request().method() === 'POST'
    );
    await nearbyRetry.click();
    const rechecked = await retryResponse;
    assert.equal(
      rechecked.request().postDataJSON().analyze,
      true,
      'The shortcut must force a fresh photo check'
    );
    assert.equal(editChecks, 1, 'One click must submit only one recheck');
    page.off('request', countChecks);
    await page.waitForFunction(
      () =>
        !document.querySelector('#report-form [name=category]').disabled &&
        !document
          .querySelector('.photo-assist')
          .textContent.includes('Screening photo and suggesting')
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#report-form [name=category]').value ===
        'Facilities, Infrastructure & Maintenance'
    );
    assert.equal(
      await page.locator('#report-form [name=description]').inputValue(),
      'My edited observation must survive another analysis.'
    );
    await page.getByRole('button', { name: 'Use AI description draft', exact: true }).click();
    assert.equal(
      await page.locator('#report-form [name=description]').inputValue(),
      'A classroom chair has visible damage and requires inspection.'
    );
    assert.equal(
      await page.locator('#description-recheck').count(),
      0,
      'Restoring the AI draft must remove the edit prompt'
    );
    await page.locator('#report-form [name=category]').selectOption('Safety, Security & Risk');
    assert.equal(
      await page
        .locator('#report-form [name=categories][value="Facilities, Infrastructure & Maintenance"]')
        .isChecked(),
      true,
      'Changing primary must preserve the previous AI-selected category'
    );
    await page
      .locator('#report-form [name=categories][value="Facilities, Infrastructure & Maintenance"]')
      .uncheck();
    assert.equal(
      await page
        .locator('#report-form [name=categories][value="Facilities, Infrastructure & Maintenance"]')
        .isChecked(),
      false,
      'AI category suggestions must remain editable'
    );
    await page
      .locator('#report-form [name=categories][value="Facilities, Infrastructure & Maintenance"]')
      .check();
    await page
      .locator('#report-form [name=categories][value="ICT, Internet & Digital Services"]')
      .check();
    assert.equal(
      await page.locator('#report-form [name=title]').inputValue(),
      'Damaged classroom chair'
    );
    assert.equal(
      await page.locator('#report-form [name=category]').inputValue(),
      'Safety, Security & Risk'
    );
    await page.locator('#pick-map .leaflet-control-zoom-in').click();
    await page.waitForTimeout(300);
    await page.locator('#pick-map .leaflet-control-zoom-in').click();
    await page.waitForTimeout(350);
    const planWidth = () =>
      page
        .locator('#pick-map .leaflet-image-layer')
        .evaluate((image) => image.getBoundingClientRect().width);
    const selectedZoom = await planWidth();
    await page
      .context()
      .setGeolocation({ latitude: 8.24175844, longitude: 124.24389112, accuracy: 10 });
    await page.context().grantPermissions(['geolocation'], { origin: base });
    await page.getByRole('button', { name: 'Use current location', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('#report-form [name=location]').value === 'COE Building'
    );
    await page.waitForTimeout(500);
    assert.equal(await planWidth(), selectedZoom, 'Current location must preserve the chosen zoom');
    const beforeDrag = await page.locator('#pin-label').innerText();
    // A fresh provider result avoids Chrome's allowed one-minute GPS cache.
    await page.evaluate(() => {
      window.fixtureGeolocation = navigator.geolocation.getCurrentPosition.bind(
        navigator.geolocation
      );
      navigator.geolocation.getCurrentPosition = (success) =>
        success({ coords: { latitude: 8, longitude: 124, accuracy: 10 } });
    });
    await page.getByRole('button', { name: 'Use current location', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'outside the supplied MSU–IIT site plan' })
      .waitFor();
    assert.equal(
      await page.locator('#pin-label').innerText(),
      beforeDrag,
      'An off-campus device location must not replace the selected campus pin'
    );
    assert.equal(
      await planWidth(),
      selectedZoom,
      'An off-campus device location must preserve zoom'
    );

    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = window.fixtureGeolocation;
      delete window.fixtureGeolocation;
    });
    const marker = await page.locator('#pick-map .leaflet-marker-icon').boundingBox();
    await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
    await page.mouse.down();
    await page.mouse.move(marker.x + marker.width / 2 + 60, marker.y + marker.height / 2 + 25, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForFunction(
      (previous) => document.querySelector('#pin-label').textContent !== previous,
      beforeDrag
    );
    await page
      .locator('#report-form [name=location_details]')
      .fill('2nd floor, Room 204, beside the stairs');
    await page.locator('#pick-map').click({ position: { x: 120, y: 100 } });
    assert.equal(await page.locator('#pick-map .leaflet-marker-icon.pin-glide').count(), 1);
    assert.equal(
      await page
        .locator('#pick-map .leaflet-marker-icon')
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      '0.28s'
    );
    await page.waitForFunction(
      () => document.querySelector('#report-form [name=location]').value.length > 0
    );
    await page.locator('#clear-pin').click();
    assert.equal(await page.locator('#report-form [name=location]').inputValue(), '');
    await page.locator('#pick-map').click({ position: { x: 150, y: 100 } });
    await page.waitForFunction(
      () => document.querySelector('#report-form [name=location]').value.length > 0
    );
    await page.locator('#report-form [name=title]').fill('Browser test: broken library chair');
    await page.locator('#report-form [name=location]').fill('Library reading area');
    await page
      .locator('#report-form [name=description]')
      .fill('A chair is broken near the reading area. Please inspect and repair it.');
    await page.getByRole('button', { name: 'Submit for validation', exact: true }).click();
    await page
      .locator('#modal-title')
      .filter({ hasText: 'Browser test: broken library chair' })
      .waitFor();
    await page.getByText('2nd floor, Room 204, beside the stairs', { exact: false }).waitFor();
    await page.locator('.evidence-card').getByText('photo.jpg', { exact: true }).waitFor();
    assert.equal(
      await page.locator('#modal .report-description').first().innerText(),
      'A chair is broken near the reading area. Please inspect and repair it.'
    );
    await page
      .locator('.evidence-card')
      .getByText('A classroom chair has visible damage and requires inspection.', { exact: false })
      .waitFor();
    await page
      .locator('.evidence-card')
      .getByText('Damaged classroom chair', { exact: false })
      .waitFor();
    await page
      .locator('.evidence-card')
      .getByText('Facilities, Infrastructure & Maintenance', { exact: false })
      .waitFor();
    await page.locator('#modal').evaluate((dialog) => {
      dialog.scrollTop = dialog.scrollHeight;
    });
    await page.mouse.click(5, 5);
    assert.equal(
      await page.locator('#modal').count(),
      0,
      'Backdrop close must work when the dialog is scrolled to the bottom'
    );
    await logout();
    await login('validator@iitvoice.local');
    assert.equal(await page.locator('[data-page=users]').count(), 0);
    await page.screenshot({
      path: path.join(root, 'test-results/validator-admin.png'),
      fullPage: true,
    });
    await page.locator('.sidebar [data-page=queue]').click();
    assert.equal(await page.locator('#filter-sort').inputValue(), 'newest');
    const order = await page
      .locator('#report-results [data-report]')
      .evaluateAll((buttons) => buttons.map((button) => Number(button.dataset.report)));
    assert.deepEqual(
      order,
      [...order].sort((a, b) => b - a),
      'Latest submissions must appear first'
    );
    for (const category of [
      'Safety, Security & Risk',
      'Facilities, Infrastructure & Maintenance',
      'ICT, Internet & Digital Services',
    ]) {
      await page.locator('#filter-category').selectOption(category);
      assert.equal(
        await page
          .locator('#report-results .list-row')
          .filter({ hasText: 'Browser test: broken library chair' })
          .count(),
        1
      );
    }
    await page.locator('#filter-area').selectOption('Digital & Academic');
    assert.equal(
      await page
        .locator('#report-results .list-row')
        .filter({ hasText: 'Browser test: broken library chair' })
        .count(),
      1
    );
    await page.locator('#filter-area').selectOption('Operations & Governance');
    assert.equal(
      await page
        .locator('#report-results .list-row')
        .filter({ hasText: 'Browser test: broken library chair' })
        .count(),
      0
    );
    await page.locator('#filter-area').selectOption('');
    await page.screenshot({
      path: path.join(root, 'test-results/category-filters.png'),
      fullPage: false,
    });
    const row = page.locator('.list-row').filter({ hasText: 'Browser test: broken library chair' });
    await row.getByRole('button', { name: 'View concern →' }).click();
    await page.locator('#validation-form').waitFor();
    assert.equal(
      await page
        .locator('#modal #review-form, #modal #comment-form, #modal #evidence-form')
        .count(),
      0,
      'Validators may only submit validation'
    );
    assert.equal(
      await page
        .locator('#validation-form [name=category], #validation-form [name=visibility]')
        .count(),
      0
    );
    assert.equal(await page.locator('#validation-form .priority-choice').count(), 4);
    await page
      .locator('#validation-form')
      .getByRole('radio', { name: 'Urgent', exact: true })
      .check();
    assert.equal(
      await page.locator('#validation-form .priority-choice.selected input').inputValue(),
      'urgent'
    );
    await page
      .locator('.evidence-card')
      .getByText('Damaged classroom chair', { exact: false })
      .waitFor();
    await page.locator('#validation-form [name=office_id]').selectOption('4');
    const ictAdmin = await page
      .locator('#validation-form [name=assigned_to] option')
      .filter({ hasText: 'ICT Demo' })
      .getAttribute('value');
    await page.locator('#validation-form [name=assigned_to]').selectOption(ictAdmin);
    await page
      .locator('#validation-form [name=note]')
      .fill('Location and condition verified. Routed to ICT for action.');
    const reportId = Number(
      (await page.locator('#modal .eyebrow').innerText()).match(/IV-(\d+)/)[1]
    );
    await page.screenshot({
      path: path.join(root, 'test-results/validator-assignment.png'),
      fullPage: false,
    });
    await page.getByRole('button', { name: 'Submit validation', exact: true }).click();
    await page.getByRole('heading', { name: 'Validation submitted', exact: true }).waitFor();
    await page.locator('#modal-content > .badges .badge.urgent').waitFor();
    await page.locator('.dialog-close').click();
    await logout();
    await login('plant@iitvoice.local');
    assert.equal(await page.locator('[data-page=users]').count(), 0);
    assert.equal(
      await page
        .locator('.list-row')
        .filter({ hasText: 'Browser test: broken library chair' })
        .count(),
      0
    );
    assert.equal(
      await page.evaluate(async (id) => (await fetch(`/api/reports/${id}`)).status, reportId),
      404,
      'Other office cannot open the assigned concern'
    );
    await logout();
    await login('ict@iitvoice.local');
    assert.equal(await page.locator('[data-page=users]').count(), 0);
    await page.locator('.sidebar [data-page=map]').click();
    await page.getByRole('button', { name: 'Report pins', exact: true }).click();
    await page.locator('#campus-map .report-marker').waitFor();
    assert.equal(
      await page.locator('#campus-map .report-marker').getAttribute('data-report-id'),
      String(reportId),
      'Office maps must contain only handed-off concerns for that office'
    );
    assert.equal(
      await page.locator('#campus-map .report-marker').getAttribute('data-priority'),
      'urgent',
      'The validator urgency must carry through to the assigned office map'
    );
    await page
      .getByLabel('Category', { exact: true })
      .selectOption('Facilities, Infrastructure & Maintenance');
    assert.equal(
      await page.locator('#campus-map .report-marker').count(),
      1,
      'An additional category must match without duplicating the pin'
    );
    await page.locator('.sidebar [data-page=overview]').click();
    const officeRow = page
      .locator('.list-row')
      .filter({ hasText: 'Browser test: broken library chair' });
    await officeRow.getByRole('button', { name: 'View concern →' }).click();
    await page.locator('#office-progress-form').waitFor();
    assert.equal(await page.locator('#review-form, #validation-form').count(), 0);
    await page.locator('#office-progress-form [name=note]').fill('Inspection started by ICT.');
    await page.getByRole('button', { name: 'Start work', exact: true }).click();
    await page.locator('#modal-content > .badges .badge.in_progress').waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Start work', exact: true }).count(),
      0,
      'Already-started work must not submit the same status again'
    );
    await page
      .locator('#office-progress-form [name=note]')
      .fill('Work completed and checked by ICT.');
    assert.equal(
      await page.getByRole('button', { name: 'Mark work complete', exact: true }).isDisabled(),
      true,
      'Completion requires an after photo'
    );
    assert.equal(
      await page.evaluate(async (id) => {
        const me = await (await fetch('/api/me')).json();
        return (
          await fetch(`/api/reports/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf },
            body: JSON.stringify({
              status: 'resolved',
              note: 'Attempt completion without an after photo.',
            }),
          })
        ).status;
      }, reportId),
      400,
      'Direct API cannot bypass completion evidence'
    );
    assert.equal(await page.locator('#evidence-form [name=stage]').inputValue(), 'after');
    await page.locator('#evidence-form [name=image]').setInputFiles(blockedFixture);
    await page.locator('#evidence-form .photo-screening.rejected').waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Upload evidence', exact: true }).isDisabled(),
      true,
      'Blocked evidence cannot be uploaded'
    );
    await page.locator('#evidence-form [name=image]').setInputFiles(photo);
    await page
      .locator('#evidence-form .photo-assist .inline-error')
      .filter({ hasText: 'same photo' })
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Upload evidence', exact: true }).isDisabled(),
      true,
      'The original picture must not be uploaded again'
    );
    assert.equal(
      await page.getByRole('button', { name: 'Mark work complete', exact: true }).isDisabled(),
      true,
      'The original picture cannot unlock completion'
    );
    for (const [color, verdict] of [
      ['green', 'unrelated'],
      ['orange', 'still_unresolved'],
      ['purple', 'unclear'],
      ['yellow', 'unavailable'],
    ]) {
      const filename = coloredPhoto(color);
      await page.locator('#evidence-form [name=image]').setInputFiles(filename);
      await page.locator(`#evidence-form .completion-check.${verdict}`).waitFor();
      await page.locator('#evidence-form .photo-screening.appropriate').waitFor();
      assert.equal(
        await page.getByRole('button', { name: 'Upload evidence', exact: true }).isDisabled(),
        true,
        'Safe content alone must not qualify as completion evidence'
      );
      assert.equal(
        await page.getByRole('button', { name: 'Mark work complete', exact: true }).isDisabled(),
        true
      );
      const rejected = await page.evaluate(
        async ({ id, data }) => {
          const me = await (await fetch('/api/me')).json();
          return (
            await fetch(`/api/reports/${id}/attachments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf },
              body: JSON.stringify({
                data,
                stage: 'after',
                completion_check: { status: 'supports_completion' },
              }),
            })
          ).status;
        },
        { id: reportId, data: fs.readFileSync(filename).toString('base64') }
      );
      assert.equal(
        rejected,
        verdict === 'unavailable' ? 503 : 422,
        'The API must reject a forged completion verdict'
      );
    }
    await page.locator('#evidence-form [name=image]').setInputFiles(coloredPhoto('gray'));
    await page.locator('#evidence-form .completion-check.supports_completion').waitFor();
    await page.getByRole('button', { name: 'Upload evidence', exact: true }).click();
    await page
      .locator('.evidence-comparison section')
      .filter({ has: page.getByRole('heading', { name: 'After — completed work', exact: true }) })
      .locator('.evidence-card')
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Mark work complete', exact: true }).isEnabled(),
      true,
      'Uploaded after photo unlocks completion'
    );
    await page
      .locator('.evidence-comparison')
      .screenshot({ path: path.join(root, 'test-results/before-after-evidence.png') });
    await page.locator('#office-progress-form').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(root, 'test-results/office-workspace.png'),
      fullPage: false,
    });
    await page.getByRole('button', { name: 'Mark work complete', exact: true }).click();
    await page.getByRole('heading', { name: 'Work completed', exact: true }).waitFor();
    await page.locator('.dialog-close').click();
    await logout();
    await login('admin@iitvoice.local');
    await page.locator('.sidebar [data-page=reports]').click();
    await page.locator('#search').fill('Browser test');
    await page.getByRole('button', { name: 'View concern →' }).click();
    await page.locator('#review-form').waitFor();
    await page.locator('#review-form [name=status]').selectOption('closed');
    await page
      .locator('#review-form [name=note]')
      .fill('Office resolution checked; concern closed.');
    await page.getByRole('button', { name: 'Save decision', exact: true }).click();
    await page.locator('#modal .badge.closed').waitFor();
    await page.locator('.dialog-close').click();
    await logout();
    await login('student@iitvoice.local');
    await page.locator('[data-new]').click();
    await page.locator('#report-form').waitFor();
    await page.locator('#report-form [name=image]').setInputFiles(reviewFixture);
    await page.locator('#report-form .photo-screening.needs_review').waitFor();
    assert.equal(await page.locator('.photo-preview').count(), 0);
    await page.locator('#report-form [name=title]').fill('Questionable evidence fixture');
    await page.locator('#report-form [name=location]').fill('Library');
    await page
      .locator('#report-form [name=description]')
      .fill('This harmless blue test image requires manual review.');
    await page.getByRole('button', { name: 'Submit for validation', exact: true }).click();
    await page.locator('.evidence-card .photo-screening.needs_review').waitFor();
    assert.equal(await page.locator('.evidence-card img').count(), 0);
    await page.locator('.dialog-close').click();
    await logout();
    await login('validator@iitvoice.local');
    await page.locator('.sidebar [data-page=reports]').click();
    await page.locator('#search').fill('Questionable evidence fixture');
    await page.getByRole('button', { name: 'View concern →' }).click();
    await page.locator('.evidence-card .photo-screening.needs_review').waitFor();
    assert.equal(
      await page.locator('.evidence-card img').count(),
      0,
      'Flagged image must not be fetched or shown automatically'
    );
    await page
      .locator('.evidence-card')
      .getByRole('button', { name: 'Show photo for review', exact: true })
      .click();
    assert.equal(await page.locator('.evidence-card img').count(), 1);
    await page
      .locator('.evidence-card')
      .getByRole('button', { name: 'Hide photo', exact: true })
      .click();
    assert.equal(await page.locator('.evidence-card img').count(), 0);
    await page.screenshot({
      path: path.join(root, 'test-results/validator-photo-screening.png'),
      fullPage: false,
    });
    await page.locator('.dialog-close').click();
    await logout();
    await login('student@iitvoice.local');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Report pins', exact: true }).click();
    await page.getByLabel('Color pins by', { exact: true }).selectOption('category');
    await page.locator('#campus-map .report-marker').first().waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(root, 'test-results/student-mobile.png'),
      fullPage: false,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    assert.equal(overflow, false, 'Mobile layout overflow');
    // Exercise the shared responsive layout with touch input and every staff workflow.
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    mobile.on('pageerror', (e) => errors.push(e.stack));
    async function fits(label) {
      assert.equal(
        await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        label + ' must not overflow the viewport'
      );
      const dialog = mobile.locator('#modal');
      if (await dialog.count())
        assert.equal(
          await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
          false,
          label + ' dialog must not overflow'
        );
    }
    async function mobileNavigate(id) {
      if ((await mobile.viewportSize()).width <= 700) {
        await mobile.locator('.mobile-menu summary').tap();
        await mobile.locator(`.mobile-nav [data-page=${id}]`).tap();
        assert.equal(
          await mobile.locator('.mobile-menu').evaluate((el) => el.open),
          false,
          'Choosing a mobile page must close the menu'
        );
        assert.equal(
          await mobile
            .locator('.mobile-menu summary')
            .evaluate((el) => el === document.activeElement),
          true,
          'Focus must return to the menu toggle'
        );
      } else await mobile.locator(`.sidebar [data-page=${id}]`).click();
    }
    await mobile.goto(base);
    await mobile.locator('.auth-campus-photo').evaluate((image) => image.decode());
    for (const width of [320, 390, 768]) {
      await mobile.setViewportSize({ width, height: 844 });
      await fits('Mobile sign-in');
      await mobile.screenshot({
        path: path.join(root, `test-results/login-${width}.png`),
        fullPage: true,
      });
    }
    await mobile.getByRole('button', { name: 'Request an account', exact: true }).tap();
    await mobile.locator('[name=affiliation]').waitFor();
    await fits('Mobile registration');
    await mobile.getByRole('button', { name: 'Sign in', exact: true }).tap();
    for (const role of ['Student', 'Main Admin', 'Validator Admin', 'Physical Plant']) {
      await mobile.setViewportSize({ width: 390, height: 844 });
      await mobile
        .locator('.demo-accounts')
        .getByRole('button', { name: new RegExp('^' + role + ' ') })
        .tap();
      await mobile.locator('.stats').waitFor();
      for (const width of [320, 390, 768]) {
        await mobile.setViewportSize({ width, height: 844 });
        await mobileNavigate('overview');
        await fits(role + ' overview at ' + width);
        await checkNotifications(mobile);
        if (role === 'Main Admin') {
          await mobile
            .getByRole('group', { name: 'Report summary filters', exact: true })
            .getByLabel('Submission period', { exact: true })
            .selectOption('custom');
          await fits('Main Admin summary filters at ' + width);
          if (width === 390)
            await mobile
              .locator('.report-analytics > .summary-grid')
              .first()
              .screenshot({ path: path.join(root, 'test-results/admin-summary-mobile.png') });
        }
        await mobileNavigate(
          role === 'Student' ? 'mine' : role === 'Validator Admin' ? 'queue' : 'reports'
        );
        await mobile.locator('#search').waitFor();
        await fits(role + ' reports at ' + width);
        await mobileNavigate('map');
        await mobile.getByRole('button', { name: 'Report pins', exact: true }).tap();
        await mobile.locator('#campus-map').waitFor();
        await fits(role + ' map at ' + width);
        if (width === 390) {
          const map = mobile.locator('#campus-map');
          const image = map.locator('.leaflet-image-layer');
          const focusedWidth = await image.evaluate((el) => el.getBoundingClientRect().width);
          assert.ok(
            focusedWidth > (await map.boundingBox()).width,
            'Phone maps should start close enough to read and pan'
          );
          await mobile
            .getByRole('button', { name: 'Show the whole campus plan', exact: true })
            .tap();
          await mobile.waitForTimeout(350);
          assert.ok(
            (await image.evaluate((el) => el.getBoundingClientRect().width)) < focusedWidth,
            'Fit campus must zoom out to show the whole plan'
          );
          await map.locator('.leaflet-control-zoom-in').tap();
          await mobile.waitForTimeout(350);
          await map.locator('.leaflet-control-zoom-in').tap();
          await mobile.waitForTimeout(350);
        }

        if (width === 390) {
          await mobile.waitForTimeout(300);
          await mobile.screenshot({
            path: path.join(
              root,
              'test-results/' + role.toLowerCase().replaceAll(' ', '-') + '-mobile-map.png'
            ),
            fullPage: true,
          });
          await mobile.locator('#campus-map .leaflet-control-zoom-in').tap();
          await mobile.getByRole('button', { name: 'Campus plan', exact: true }).tap();
        }
      }
      await mobile.setViewportSize({ width: 390, height: 844 });
      await mobileNavigate('overview');
      if (role === 'Student') {
        await mobile.getByRole('button', { name: 'Report pins', exact: true }).tap();
        await mobile.waitForTimeout(300);
        await mobile.screenshot({
          path: path.join(root, 'test-results/student-mobile.png'),
          fullPage: true,
        });
        await mobile.locator('.mobile-menu summary').tap();
        await mobile.waitForTimeout(300);
        await mobile.screenshot({ path: path.join(root, 'test-results/mobile-menu.png') });
        await mobile.keyboard.press('Escape');
        assert.equal(
          await mobile.locator('.mobile-menu').evaluate((el) => el.open),
          false,
          'Escape closes the mobile menu'
        );
        await mobile.locator('[data-new]').tap();
        await mobile.locator('#report-form [name=title]').fill('Mobile report draft');
        await mobile.locator('#report-form .category-selection summary').tap();
        await mobile.setViewportSize({ width: 320, height: 844 });
        await fits('Expanded mobile report categories at 320px');
        await mobile.setViewportSize({ width: 390, height: 844 });
        await mobile.waitForTimeout(300);
        await mobile.screenshot({ path: path.join(root, 'test-results/mobile-report-form.png') });
        await mobile.locator('#report-form [name=image]').setInputFiles(photo);
        await mobile.locator('#report-form .photo-screening.appropriate').waitFor();
        await mobile.locator('.description-editor').scrollIntoViewIfNeeded();
        await mobile
          .locator('#report-form [name=description]')
          .fill('The classroom feels extremely hot in the afternoon.');
        const mobileRetry = mobile
          .locator('#description-recheck')
          .getByRole('button', { name: 'Check photo again', exact: true });
        await mobileRetry.waitFor();
        const mobileRetryBounds = await mobileRetry.boundingBox(),
          mobileModalBounds = await mobile.locator('#modal').boundingBox();
        assert.ok(
          mobileRetryBounds.y >= mobileModalBounds.y - 1 &&
            mobileRetryBounds.y + mobileRetryBounds.height <=
              mobileModalBounds.y + mobileModalBounds.height + 1,
          'The recheck button must stay visible near the edited text on a phone without extra scrolling'
        );
        await fits('Mobile description recheck shortcut');
        await mobile.screenshot({
          path: path.join(root, 'test-results/mobile-description-recheck.png'),
        });
        await mobile.getByRole('button', { name: 'Remove photo', exact: true }).click();
        assert.equal(
          await mobile.locator('#description-recheck').count(),
          0,
          'Removing the photo must remove the recheck shortcut'
        );
        assert.equal(
          await mobile.locator('#report-form [name=description]').inputValue(),
          'The classroom feels extremely hot in the afternoon.',
          'Removing a photo must preserve the description'
        );
        await mobile.locator('#report-form button[type=submit]').scrollIntoViewIfNeeded();
        const close = await mobile.locator('.dialog-close').boundingBox();
        assert.ok(
          close.y >= 0 && close.y + close.height <= 844,
          'Close button must stay visible at the bottom of a long report'
        );
        await fits('Scrolled mobile report');
        await mobile.locator('.dialog-close').tap();
      } else if (role === 'Main Admin') {
        await mobileNavigate('users');
        await mobile.locator('table').waitFor();
        await fits('Mobile user management');
        const table = mobile.locator('.table-wrap');
        await table.evaluate((el) => (el.scrollLeft = el.scrollWidth));
        assert.ok(
          (await table.evaluate((el) => el.scrollLeft)) > 0,
          'Wide account table should scroll within its panel'
        );
        await mobileNavigate('routing');
        await mobile.locator('.routing-form').first().waitFor();
        await fits('Mobile office routing');
        await mobileNavigate('audit');
        await mobile.locator('table').waitFor();
        await fits('Mobile audit history');
      } else {
        await mobileNavigate(role === 'Validator Admin' ? 'queue' : 'reports');
        await mobile.getByRole('button', { name: 'View concern →' }).first().tap();
        await mobile.locator('#modal-title').waitFor();
        await fits(role + ' mobile concern');
        const form = mobile.locator(
          role === 'Validator Admin' ? '#validation-form' : '#comment-form'
        );
        await form.scrollIntoViewIfNeeded();
        await mobile.screenshot({
          path: path.join(
            root,
            'test-results/' + role.toLowerCase().replaceAll(' ', '-') + '-mobile-concern.png'
          ),
        });
        await fits(role + ' mobile form');
        await mobile.locator('.dialog-close').tap();
      }
      await mobile.locator('.topbar .notification-trigger').tap();
      await mobile.getByRole('heading', { name: 'Your notifications', exact: true }).waitFor();
      await fits(role + ' notifications');
      if (role === 'Main Admin')
        await mobile.screenshot({ path: path.join(root, 'test-results/notifications-mobile.png') });
      await mobile.getByRole('button', { name: 'Mark all read', exact: true }).tap();
      await mobile.waitForFunction(
        () => !document.querySelector('.notification-trigger .notification-count')
      );
      assert.equal(
        await mobile.locator('.topbar .notification-trigger').getAttribute('aria-label'),
        'Notifications, no unread',
        'Marking updates as read must clear the red count'
      );
      assert.equal(
        await mobile.locator('.mobile-nav .notification-count').count(),
        0,
        'The menu badge must also clear'
      );
      await mobile.locator('.topbar [data-logout]').tap();
      await mobile.locator('#auth-form').waitFor();
    }
    await mobile.close();
    assert.deepEqual(
      externalMaps,
      [],
      'Campus maps must not request Google Maps or OpenStreetMap tiles'
    );
    assert.deepEqual(errors, [], 'Browser JavaScript errors');
    console.log(
      'Browser workflow passed: login, role isolation, report submission, validation, resolution, photo screening, concealed review, and mobile layout.'
    );
  } finally {
    if (browser) await browser.close();
    if (service) service.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
