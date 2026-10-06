import { expect, test, type Page } from '@playwright/test';
import type { Trip, TripDraft, TripInput } from '../../lib/trips/types';
import { exampleDraft } from '../fixtures/trip-draft';

const id = '11111111-1111-4111-8111-111111111111';

async function isolatedApi(page: Page, failFirst = false, draft: TripDraft = exampleDraft()) {
  const trips: Trip[] = [];
  const mutations: string[] = [];
  let offline = failFirst;
  let updateError = false;
  await page.route('**/__test/graphql', async route => {
    const { query, variables } = route.request().postDataJSON();
    if (query.includes('query Trips')) {
      if (offline) { await route.fulfill({ status: 503, body: 'Unavailable' }); return; }
      await route.fulfill({ json: { data: { trips } } }); return;
    }
    if (query.includes('mutation GenerateDraft')) {
      mutations.push('draft');
      await route.fulfill({ json: { data: { generateTripDraft: draft } } }); return;
    }
    if (query.includes('mutation CreateTrip')) {
      mutations.push('create');
      const input = variables.input as TripInput;
      const trip: Trip = { ...input, id, revision: 0, createdAt: '', updatedAt: '', stops: input.stops.map((stop, position) => ({ ...stop, id: `stop-${position}`, tripId: id, position })), transportLegs: [], stays: [], activities: [] };
      trips.push(trip);
      await route.fulfill({ json: { data: { createTrip: trip } } }); return;
    }
    if (query.includes('mutation UpdateTrip')) {
      expect(variables.expectedRevision).toBe(trips[0]!.revision);
      if (updateError) { updateError = false; await route.fulfill({ json: { errors: [{ message: 'This trip changed in another request. Refresh and try again.', extensions: { code: 'REVISION_CONFLICT' } }] } }); return; }
      mutations.push('update');
      const { stops: dates, newStops = [], ...details } = variables.input;
      const previous = trips[0]!;
      trips[0] = { ...previous, ...details, revision: previous.revision + 1,
        stops: [...previous.stops.map(stop => ({ ...stop, ...dates?.find((value: { id: string }) => value.id === stop.id) })),
          ...newStops.map((stop: TripInput['stops'][number], index: number) => ({ ...stop, id: `added-${previous.revision}-${index}`, tripId: previous.id, position: previous.stops.length + index }))],
      };
      await route.fulfill({ json: { data: { updateTrip: trips[0] } } }); return;
    }
    throw new Error(`Unexpected GraphQL operation: ${query.slice(0, 90)}`);
  });
  return { trips, mutations, recover: () => { offline = false; }, failUpdate: () => { updateError = true; } };
}

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1600]) {
    test(`trip editing and full-width view at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem('tripdock-theme', value), theme);
      const api = await isolatedApi(page);
      api.trips.push({ id, name: 'Editable trip', startDate: '2028-04-02', endDate: '2028-04-06', destinationArea: 'Porto', travelerCount: null, revision: 0, createdAt: '', updatedAt: '',
        stops: [{ id: 'porto', tripId: id, name: 'Porto', position: 0, locationText: null, arrivalDate: '2028-04-02', departureDate: '2028-04-06' }],
        activities: [], stays: [], transportLegs: [] });
      await page.goto('/');
      await page.getByRole('button', { name: 'Open trip', exact: true }).click();
      if (theme === 'light') await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const main = page.getByRole('main');
      const initialWidth = (await main.boundingBox())!.width;
      const initialHeader = await page.locator('.trip-workbench-header').boundingBox();
      const controls = page.getByRole('group', { name: 'Calendar zoom', exact: true });
      const initialControls = await controls.boundingBox();
      const board = page.getByRole('region', { name: 'Itinerary by date', exact: true });
      const initialBoardWidth = (await board.boundingBox())!.width;
      const initialPoolWidth = (await page.locator('.trip-calendar-pool').boundingBox())!.width;
      await page.getByRole('button', { name: 'Expand view', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Restore width', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await page.locator('.unified-trip-calendar').boundingBox())!.width).toBe(width - 24);
      expect((await main.boundingBox())!.width).toBe(initialWidth);
      expect(await page.locator('.trip-workbench-header').boundingBox()).toEqual(initialHeader);
      expect(await controls.boundingBox()).toEqual(initialControls);
      expect((await board.boundingBox())!.width).toBeGreaterThan(initialBoardWidth);
      expect((await page.locator('.trip-calendar-pool').boundingBox())!.width).toBeGreaterThan(initialPoolWidth);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expectCalendarControlsVisible(page);
      await page.screenshot({ path: testInfo.outputPath('expanded.png'), animations: 'disabled', fullPage: width < 800 });
      await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit trip', exact: true });
      await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
      await dialog.getByRole('textbox', { name: 'Trip name', exact: true }).fill('Unsaved name');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Edit trip', exact: true })).toBeFocused();
      await expect(page.getByRole('heading', { name: 'Editable trip', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Trip name', exact: true }).fill('Summer plans');
      await chooseDate(page, 'Start date', '3');
      await chooseDate(page, 'End date', '5');
      await page.screenshot({ path: testInfo.outputPath('edit-dialog.png'), animations: 'disabled' });
      api.failUpdate();
      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(dialog.getByRole('alert')).toContainText('changed in another request');
      await expect(dialog.getByRole('textbox', { name: 'Trip name', exact: true })).toHaveValue('Summer plans');
      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Summer plans', exact: true })).toBeVisible();
      expect(api.trips[0]?.startDate).toBe('2028-04-03');
      expect(api.trips[0]?.endDate).toBe('2028-04-05');
      await expect(board.locator('.calendar-date-row th[data-day]')).toHaveCount(3);
      await expect(page.getByRole('button', { name: 'Restore width', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
      const detailsBox = await dialog.getByRole('group', { name: 'Trip details', exact: true }).boundingBox();
      const destinationsBox = await dialog.getByRole('group', { name: 'Destinations', exact: true }).boundingBox();
      expect(detailsBox!.y + detailsBox!.height).toBeLessThan(destinationsBox!.y);
      if (width > 800) {
        const nameBox = await dialog.getByRole('textbox', { name: 'Trip name', exact: true }).boundingBox();
        const startBox = await dialog.getByRole('combobox', { name: 'Start date', exact: true }).boundingBox();
        const endBox = await dialog.getByRole('combobox', { name: 'End date', exact: true }).boundingBox();
        expect(Math.abs(nameBox!.y - startBox!.y)).toBeLessThan(2);
        expect(Math.abs(startBox!.y - endBox!.y)).toBeLessThan(2);
      }
      await chooseDate(page, 'Departure date', '4');
      await dialog.getByRole('button', { name: '+ Add destination', exact: true }).click();
      await dialog.getByRole('button', { name: 'Remove new destination 2', exact: true }).click();
      await expect(dialog.getByRole('group', { name: 'Destination 2', exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: '+ Add destination', exact: true }).click();
      const added = dialog.getByRole('group', { name: 'Destination 2', exact: true });
      await added.getByRole('textbox', { name: 'City', exact: true }).fill('Lisbon');
      await added.getByRole('combobox', { name: 'Departure date', exact: true }).click();
      await page.getByRole('button', { name: /, 6 April 2028$/ }).click();
      await expect(dialog.getByRole('combobox', { name: 'End date', exact: true })).toHaveValue(/6/);
      await page.screenshot({ path: testInfo.outputPath('add-destination.png'), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(api.trips[0]?.stops.map(stop => [stop.name, stop.arrivalDate, stop.departureDate])).toEqual([
        ['Porto', '2028-04-03', '2028-04-04'], ['Lisbon', '2028-04-04', '2028-04-06'],
      ]);
      await expect(page.locator('.calendar-destination-label').filter({ hasText: 'Lisbon' })).toBeVisible();
      await page.getByRole('button', { name: 'Restore width', exact: true }).click();
      await expect.poll(async () => (await main.boundingBox())!.width).toBe(initialWidth);
      expect(await controls.boundingBox()).toEqual(initialControls);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Summer plans', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Expand view', exact: true })).toHaveAttribute('aria-pressed', 'false');
      expect(api.mutations).toEqual(['update', 'update']);
    });
  }
}

async function chooseDate(page: Page, field: string, day: string) {
  await page.getByRole('combobox', { name: field, exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`, ${day} April 2028$`) }).click();
}

async function expectCalendarControlsVisible(page: Page) {
  await expect.poll(async () => {
    const controls = await page.getByRole('group', { name: 'Calendar zoom', exact: true }).boundingBox();
    const viewport = page.viewportSize();
    if (!viewport || !controls) return false;
    return controls.x >= 0 && controls.y >= 0 && controls.x + controls.width <= viewport.width && Math.abs(viewport.height - controls.y - controls.height - 22) <= 1;
  }).toBe(true);
}

test('manual create, retained draft, editable trip, reload and modal keyboard exit', async ({ page }, testInfo) => {
  const api = await isolatedApi(page);
  await page.clock.setFixedTime(new Date('2028-04-02T12:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your trips', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Create your first trip' }).click();
  await expect(page.getByRole('heading', { name: 'Create a trip', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Trip name', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'City', exact: true }).first().fill('Porto');
  await page.getByRole('textbox', { name: 'City', exact: true }).first().press('Tab');
  await chooseDate(page, 'Arrival date', '2');
  await chooseDate(page, 'Departure date', '6');
  await page.screenshot({ path: testInfo.outputPath('manual-form.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Continue your trip' }).click();
  await expect(page.getByRole('textbox', { name: 'City', exact: true }).first()).toHaveValue('Porto');
  await page.getByRole('button', { name: 'Review trip', exact: true }).click();
  expect(api.mutations).toEqual([]);
  await page.getByRole('textbox', { name: 'Trip name', exact: true }).fill('Spring break');
  await page.screenshot({ path: testInfo.outputPath('review.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spring break' })).toBeVisible();
  expect(api.trips[0]?.stops[0]?.name).toBe('Porto');
  expect(api.trips[0]?.startDate).toBe('2028-04-02');
  await expect(page.getByRole('button', { name: 'Edit trip', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Spring break' })).toBeVisible();
  expect(api.trips[0]?.revision).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('saved-trip.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '+ Activity', exact: true }).click();
  await page.getByRole('combobox', { name: 'Scheduled time (optional)', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Choose date and time', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add activity', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Activity', exact: true })).toBeFocused();
  expect(api.mutations).toEqual(['create']);
});

test('AI draft stays unpersisted through manual review and follow-up', async ({ page }) => {
  const api = await isolatedApi(page);
  await page.goto('/');
  await page.getByRole('textbox').first().fill('Porto from 2 to 6 April 2028');
  await page.getByRole('button', { name: /draft/i }).click();
  await expect(page.getByRole('heading', { name: 'Review your trip' })).toBeVisible();
  expect(api.trips).toHaveLength(0);
  await page.getByRole('textbox', { name: 'Trip name', exact: true }).fill('My birthday');
  await page.getByRole('button', { name: /Update details/ }).click();
  await page.getByRole('button', { name: 'Review trip', exact: true }).click();
  await page.getByRole('button', { name: /Ask TripDock/ }).click();
  await page.getByRole('textbox', { name: 'Tell TripDock what to adjust' }).fill('Keep the dates.');
  await page.getByRole('button', { name: 'Update interpreted draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your trip' })).toBeVisible();
  expect(api.trips).toHaveLength(0);
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My birthday' })).toBeVisible();
  expect(api.mutations).toEqual(['draft', 'draft', 'create']);
});

test('connection retry recovers without a fixture fallback', async ({ page }) => {
  const api = await isolatedApi(page, true);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  api.recover();
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('heading', { name: 'Your trips', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your first trip starts here' })).toBeVisible();
});

test('essential clarification answers stay reviewable before the create mutation', async ({ page }) => {
  const draft = exampleDraft({
    endDate: null,
    stops: exampleDraft().stops.map(stop => ({ ...stop, departureDate: null })),
    minimumViable: false,
    questions: [{ id: 'return', fieldPaths: ['trip.endDate', 'stops.0.departureDate'], prompt: 'When will you return?', blocking: true, allowFreeText: true,
      options: [{ id: 'sixth', label: '6 April', updates: [{ path: 'trip.endDate', value: '2028-04-06' }, { path: 'stops.0.departureDate', value: '2028-04-06' }] }] }],
  });
  const api = await isolatedApi(page, false, draft);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'What do you have in mind?' }).fill('Porto in April');
  await page.getByRole('button', { name: 'Build a trip draft' }).click();
  await expect(page.getByRole('heading', { name: 'A few details first' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with selected answers' })).toBeDisabled();
  await page.getByRole('radio', { name: '6 April' }).check();
  await page.getByRole('button', { name: 'Continue with selected answers' }).click();
  await expect(page.getByRole('heading', { name: 'Review your trip' })).toBeVisible();
  expect(api.trips).toHaveLength(0);
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trip to Porto' })).toBeVisible();
  expect(api.trips[0]?.endDate).toBe('2028-04-06');
  expect(api.mutations).toEqual(['draft', 'create']);
});

for (const width of [320, 390, 768]) {
  test(`manual entry and calendar controls remain usable at ${width}px`, async ({ page }, testInfo) => {
    const api = await isolatedApi(page);
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(new Date('2028-04-02T12:00:00Z'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: '+ New trip', exact: true })).toBeInViewport();
    await expect(page.getByRole('main')).toBeFocused();
    const heading = await page.getByRole('heading', { name: 'Your trips', exact: true }).boundingBox();
    const header = await page.getByRole('banner').boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    await page.screenshot({ path: testInfo.outputPath('mobile-home.png'), animations: 'disabled' });
    // Also cover opening from the lower entry after the page has scrolled.
    await page.getByRole('button', { name: width === 390 ? 'Create your first trip' : '+ New trip', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create a trip', exact: true })).toBeInViewport();
    await expect(page.getByRole('textbox', { name: 'Trip name', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'City', exact: true }).first().fill('Porto');
    await page.getByRole('textbox', { name: 'City', exact: true }).first().press('Tab');
    await chooseDate(page, 'Arrival date', '2');
    await chooseDate(page, 'Departure date', '6');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Continue your trip', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'City', exact: true }).first()).toHaveValue('Porto');
    await page.screenshot({ path: testInfo.outputPath('mobile-form.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Review trip', exact: true }).click();
    await page.getByRole('textbox', { name: 'Trip name', exact: true }).fill('Mobile trip');
    await page.screenshot({ path: testInfo.outputPath('mobile-review.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Create trip', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mobile trip', exact: true })).toBeVisible();
    const calendar = page.getByRole('region', { name: 'Itinerary by date', exact: true });
    await expectCalendarControlsVisible(page);
    const geometry = await calendar.evaluate(element => ({
      calendar: element.getBoundingClientRect().width,
      page: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.calendar).toBeGreaterThanOrEqual(geometry.page - 34);
    expect(geometry.scrollWidth).toBe(geometry.page);
    await expect(page.locator('.calendar-destination-label', { hasText: 'Porto' })).toBeInViewport();
    await expect(page.getByRole('button', { name: '01 Porto', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Edit destination', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Stay', exact: true })).toBeInViewport();
    const addActivity = page.getByRole('button', { name: '+ Activity', exact: true });
    await addActivity.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Add activity', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(addActivity).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('mobile-schedule.png'), animations: 'disabled' });
    expect(api.mutations).toEqual(['create']);
  });
}

for (const theme of ['light', 'dark']) {
  test(`destination dates define the route and trip boundaries in ${theme} theme`, async ({ page }, testInfo) => {
    const api = await isolatedApi(page);
    await page.clock.setFixedTime(new Date('2028-04-02T12:00:00Z'));
    await page.goto('/');
    if (theme === 'light') await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'Create your first trip' }).click();
    const first = page.getByRole('group', { name: 'Destination 1', exact: true });
    const second = page.getByRole('group', { name: 'Destination 2', exact: true });
    const review = page.getByRole('button', { name: 'Review trip', exact: true });
    await expect(review).toBeDisabled();
    await first.getByRole('textbox', { name: 'City', exact: true }).fill('Lisbon');
    await first.getByRole('textbox', { name: 'City', exact: true }).press('Tab');
    await expect(second.getByRole('textbox', { name: 'City', exact: true })).toBeVisible();
    await chooseDate(page, 'Arrival date', '2');
    await expect(review).toBeDisabled();
    await chooseDate(page, 'Departure date', '6');
    await expect(review).toBeEnabled();
    await second.getByRole('textbox', { name: 'City', exact: true }).fill('Porto');
    await second.getByRole('textbox', { name: 'City', exact: true }).press('Tab');
    await expect(second.getByRole('combobox', { name: 'Arrival date', exact: true })).toHaveValue(/6/);
    await expect(second.getByRole('combobox', { name: 'Departure date', exact: true })).toHaveValue('');
    await expect(review).toBeDisabled();
    await second.getByRole('combobox', { name: 'Departure date', exact: true }).click();
    await page.getByRole('button', { name: /, 10 April 2028$/ }).click();
    await page.getByRole('heading', { name: 'Create a trip', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('destinations-desktop.png'), animations: 'disabled', fullPage: true });
    await review.click();
    expect(api.mutations).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Review your trip', exact: true })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Review your trip', exact: true })).toBeInViewport();
    await expect(page.locator('.draft-route-summary li')).toHaveCount(2);
    await expect(page.locator('.draft-overview-heading')).toContainText('10 Apr 2028');
    await expect(page.getByRole('textbox', { name: 'Trip name', exact: true })).toHaveAttribute('placeholder', 'Trip to Lisbon · Porto');
    await page.screenshot({ path: testInfo.outputPath('summary-desktop.png'), animations: 'disabled' });
    await page.getByRole('button', { name: /Update details/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('destinations-mobile.png'), animations: 'disabled', fullPage: true });
    await page.getByRole('button', { name: 'Remove destination 2', exact: true }).click();
    await expect(first.getByRole('combobox', { name: 'Departure date', exact: true })).toHaveValue(/6/);
    await review.click();
    await page.screenshot({ path: testInfo.outputPath('summary-mobile.png'), animations: 'disabled', fullPage: true });
    await page.getByRole('button', { name: 'Create trip', exact: true }).click();
    expect(api.trips[0]?.name).toBe('Trip to Lisbon');
    expect(api.trips[0]?.startDate).toBe('2028-04-02');
    expect(api.trips[0]?.endDate).toBe('2028-04-06');
    expect(api.trips[0]?.stops).toHaveLength(1);
  });
}

for (const theme of ['light', 'dark']) {
  test(`calendar zoom, fit limit, compact labels and reset in ${theme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.addInitScript((value) => localStorage.setItem('tripdock-theme', value), theme);
    const api = await isolatedApi(page);
    api.trips.push({
      id, name: 'Calendar zoom trip', startDate: '2027-08-28', endDate: '2027-09-10',
      destinationArea: 'Rome', travelerCount: null, revision: 0, createdAt: '', updatedAt: '',
      stops: [{ id: 'rome', tripId: id, name: 'Rome', position: 0, locationText: null, arrivalDate: '2027-08-28', departureDate: '2027-09-10' }],
      stays: [], transportLegs: [],
      activities: [{ id: 'walk', tripId: id, stopId: 'rome', position: 0, title: 'Explore the historic centre of Rome', status: 'PLANNED', scheduledAt: '2027-08-28T11:30:00Z', timezone: 'UTC', durationMinutes: 60 }],
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open trip', exact: true }).click();
    if (theme === 'light') await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const board = page.getByRole('region', { name: 'Itinerary by date' });
    const out = page.getByRole('button', { name: 'Zoom out calendar', exact: true });
    const reset = page.getByRole('button', { name: 'Reset calendar zoom to 100%', exact: true });
    await expect(out).toBeVisible();
    await expectCalendarControlsVisible(page);
    await expect(board.locator('.calendar-date-row th[data-day]').first()).toContainText('Sat 28 Aug');
    await board.evaluate((element) => { element.scrollLeft = 400; element.scrollTop = 0; });
    await reset.click();
    await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect.poll(() => board.evaluate((element) => {
      const row = element.querySelector('[data-hour="10:00"]')!;
      const header = element.querySelector('thead')!;
      return Math.abs(row.getBoundingClientRect().top - header.getBoundingClientRect().bottom);
    })).toBeLessThan(2);
    for (let step = 0; step < 9 && await out.isEnabled(); step++) await out.click();
    await expect(out).toBeDisabled();
    const percentage = await reset.innerText();
    expect(Number(percentage.replace('%', ''))).toBeLessThan(50);
    await expect(board.locator('.calendar-date-row th[data-day]').first().locator('span').first()).toHaveText('Sat 28/08');
    const geometry = await board.evaluate((element) => {
      const table = element.querySelector('table')!;
      const body = element.querySelector('tbody')!;
      const header = element.querySelector('thead')!;
      return { width: table.scrollWidth, height: table.offsetHeight, viewportWidth: element.clientWidth, viewportHeight: element.clientHeight, bodyHeight: body.getBoundingClientRect().height, availableBodyHeight: element.clientHeight - header.offsetHeight, axisWidth: element.querySelector('col')!.getBoundingClientRect().width };
    });
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    expect(geometry.bodyHeight).toBeGreaterThanOrEqual(geometry.availableBodyHeight - 1);
    expect(geometry.axisWidth).toBeCloseTo(62, 0);
    await expectCalendarControlsVisible(page);
    await page.screenshot({ path: testInfo.outputPath(`calendar-compact-${theme}.png`), animations: 'disabled' });
    await reset.click();
    await expect(reset).toHaveText('100%');
    await expect.poll(() => board.evaluate((element) => Math.abs(element.querySelector('[data-hour="10:00"]')!.getBoundingClientRect().top - element.querySelector('thead')!.getBoundingClientRect().bottom))).toBeLessThan(2);
    await expect(out).toBeEnabled();
    await expectCalendarControlsVisible(page);
    await page.screenshot({ path: testInfo.outputPath(`calendar-default-${theme}.png`), animations: 'disabled' });
    expect(api.mutations).toEqual([]);
  });
}
