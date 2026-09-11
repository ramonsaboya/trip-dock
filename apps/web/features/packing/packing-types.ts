import { type PlanEdit } from '../../lib/packing-client.ts';

export type EditPacking = (input: PlanEdit) => Promise<boolean>;
