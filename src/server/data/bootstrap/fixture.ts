import { generatePatagoniaFixture, hashPatagoniaFixture } from '../../../domain/fixtures/patagonia';

export const fixture = generatePatagoniaFixture();
export const fixtureHash = hashPatagoniaFixture(fixture);
export const demoProjectKey = 'PED';
