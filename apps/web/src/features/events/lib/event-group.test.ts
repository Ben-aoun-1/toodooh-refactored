import { describe, expect, it } from 'vitest';

import { groupPositioningPath, parseGroupIds } from './event-group';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('the multi-match parcours URL', () => {
  it('round-trips the draft ids, dropping junk and duplicates', () => {
    expect(groupPositioningPath([A, B])).toBe(`/evenements/positionnement-groupe?ids=${A},${B}`);
    expect(parseGroupIds(`?ids=${A},${B}`)).toEqual([A, B]);
    expect(parseGroupIds(`?ids=${A},nope,${A}, ${B}`)).toEqual([A, B]);
    expect(parseGroupIds('')).toEqual([]);
  });
});
