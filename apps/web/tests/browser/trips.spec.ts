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

test('manual create, retained edits, accepted revision, reload and modal keyboard exit', async ({ page }, testInfo) => {
  const api = await isolatedApi(page);
  await page.clock.setFixedTime(new Date('2028-04-02T12:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your trips', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Create your first trip' }).click();
  await expect(page.getByRole('heading', { name: 'Create a trip', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Trip name', exact: true }).fill('Spring break');
  await page.getByRole('textbox', { name: 'City', exact: true }).first().fill('Porto');
  await page.getByRole('textbox', { name: 'City', exact: true }).first().press('Tab');
  await chooseDate(page, 'Start date', '2');
  await chooseDate(page, 'End date', '6');
  await page.screenshot({ path: testInfo.outputPath('manual-form.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Continue your trip' }).click();
  await expect(page.getByRole('textbox', { name: 'Trip name', exact: true })).toHaveValue('Spring break');
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spring break' })).toBeVisible();
  expect(api.trips[0]?.stops[0]?.name).toBe('Porto');
  expect(api.trips[0]?.startDate).toBe('2028-04-02');
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await page.getByRole('textbox', { name: 'Trip name', exact: true }).fill('Spring holiday');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Spring holiday' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Spring holiday' })).toBeVisible();
  expect(api.trips[0]?.revision).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('saved-trip.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await page.getByRole('combobox', { name: 'Start date', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Choose date', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit trip essentials' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit trip', exact: true })).toBeFocused();
  expect(api.mutations).toEqual(['create', 'update']);
});

test('AI draft stays unpersisted through manual review and follow-up', async ({ page }) => {
  const api = await isolatedApi(page);
  await page.goto('/');
  await page.getByRole('textbox').first().fill('Porto from 2 to 6 April 2028');
  await page.getByRole('button', { name: /draft/i }).click();
  await expect(page.getByRole('heading', { name: 'Review your trip' })).toBeVisible();
  expect(api.trips).toHaveLength(0);
  await page.getByRole('button', { name: /Update details/ }).click();
  await page.getByRole('textbox', { name: 'Trip name', exact: true }).fill('My birthday');
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
    await page.getByRole('textbox', { name: 'Trip name', exact: true }).fill('Mobile trip');
    await page.getByRole('textbox', { name: 'City', exact: true }).first().fill('Porto');
    await page.getByRole('textbox', { name: 'City', exact: true }).first().press('Tab');
    await chooseDate(page, 'Start date', '2');
    await chooseDate(page, 'End date', '6');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Continue your trip', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Trip name', exact: true })).toHaveValue('Mobile trip');
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
    await expect(page.getByRole('button', { name: '01 Porto', exact: true })).toBeInViewport();
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
