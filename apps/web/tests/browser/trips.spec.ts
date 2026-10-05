import { expect, test, type Page } from '@playwright/test';
import type { Trip, TripDraft, TripInput } from '../../lib/trips/types';
import { exampleDraft } from '../fixtures/trip-draft';

const id = '11111111-1111-4111-8111-111111111111';

async function isolatedApi(page: Page, failFirst = false, draft: TripDraft = exampleDraft()) {
  const trips: Trip[] = [];
  const mutations: string[] = [];
  let offline = failFirst;
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
      mutations.push('update');
      trips[0] = { ...trips[0]!, ...variables.input, revision: trips[0]!.revision + 1 };
      await route.fulfill({ json: { data: { updateTrip: trips[0] } } }); return;
    }
    throw new Error(`Unexpected GraphQL operation: ${query.slice(0, 90)}`);
  });
  return { trips, mutations, recover: () => { offline = false; } };
}

async function chooseDate(page: Page, field: string, day: string) {
  await page.getByRole('combobox', { name: field, exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`, ${day} April 2028$`) }).click();
}

test('manual create, retained draft, locked trip, reload and modal keyboard exit', async ({ page }, testInfo) => {
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
  await expect(page.getByRole('button', { name: 'Edit trip', exact: true })).toHaveCount(0);
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
    await page.screenshot({ path: testInfo.outputPath(`calendar-compact-${theme}.png`), animations: 'disabled' });
    await reset.click();
    await expect(reset).toHaveText('100%');
    await expect.poll(() => board.evaluate((element) => Math.abs(element.querySelector('[data-hour="10:00"]')!.getBoundingClientRect().top - element.querySelector('thead')!.getBoundingClientRect().bottom))).toBeLessThan(2);
    await expect(out).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`calendar-default-${theme}.png`), animations: 'disabled' });
    expect(api.mutations).toEqual([]);
  });
}
