import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMidjourneyPrompt, buildMidjourneyImaginePayload } from '../lib/midjourney.ts';
import { buildCharacterBiblePrompt, buildCharacterConceptGridPrompt, buildStoryWorldAnchorPrompt } from '../lib/promptArchitecture.ts';

test('negative character-sheet wording must not replace a location with a generic portrait', () => {
  const locations = ['Royal Archive: carved stone corridors and copper cabinets', 'Harbor: timber piers and sailboats in rain'];
  const compiled = locations.map(sceneStyle => {
    const source = buildStoryWorldAnchorPrompt({sceneStyle, characterNames:[], aspectRatio:'1:1'});
    // Both explicit production mode and inferred generic mode must keep the goal.
    for (const taskMode of ['story-shot', undefined]) {
      const prompt = buildMidjourneyPrompt(source, {taskMode,hasPeople:false,hasStyleReference:true});
      assert.ok(prompt.includes(sceneStyle));
      assert.doesNotMatch(prompt, /Cinematic character portrait|clean neutral background|subject occupied by the scene|unposed performance/);
      assert.doesNotMatch(prompt, /not specified|PRODUCTION STYLE BIBLE|STILL IMAGE SPECIFICATION/);
      if (taskMode === 'story-shot') {
        assert.match(prompt, /wide environmental master shot/);
        assert.match(prompt, /One clean 1:1 film frame/);
        assert.doesNotMatch(prompt, /principal character|20–35%/);
      }
    }
    return buildMidjourneyPrompt(source, {taskMode:'story-shot',hasPeople:false});
  });
  assert.notEqual(...compiled);
});

test('unoccupied scenes retain explicitly selected camera treatment without inventing actors', () => {
  const prompt = buildMidjourneyPrompt('An empty street.',{hasPeople:false,capturePreset:'surveillance'});
  assert.match(prompt,/fixed high-angle surveillance viewpoint/);
  assert.match(prompt,/no people/);
  assert.doesNotMatch(prompt,/unposed performance/);
});

test('negated storyboard and character sheet descriptions do not determine the output mode', () => {
  for (const phrase of ['not a character sheet', 'not a production identity bible', 'not a 3x3 storyboard contact sheet']) {
    const prompt = buildMidjourneyPrompt(`A quiet lighthouse, ${phrase}.`, {hasPeople:false});
    assert.match(prompt, /quiet lighthouse/);
    assert.doesNotMatch(prompt, /neutral studio/);
  }
});

test('character bible keeps concrete identity and views without movie-action boilerplate', () => {
  const source = buildCharacterBiblePrompt({name:'Aster',description:'Adult with short black curls and an uneven hairline.',costumeDesc:'A faded green coat with a single copper clasp.',hasIdentityReference:true});
  const prompt = buildMidjourneyPrompt(source,{hasStyleReference:true,capturePreset:'broadcast-candid'});
  assert.match(prompt,/short black curls/);
  assert.match(prompt,/single copper clasp/);
  assert.match(prompt,/front, three-quarter, side and back views/);
  assert.match(prompt,/one identity/);
  assert.doesNotMatch(prompt,/not specified|causal action|unposed performance|live-television candid|subject occupied/);
});

test('concept candidate count remains distinct from a single-identity turnaround', () => {
  const source = buildCharacterConceptGridPrompt({name:'Aster',description:'An adult navigator.',candidateCount:4});
  const prompt = buildMidjourneyPrompt(source,{taskMode:'character-sheet',hasStyleReference:true});
  assert.match(prompt,/exactly 4 distinct candidates/);
  assert.doesNotMatch(prompt,/one identity|same identity in full-body/);
});

test('long identity descriptions retain their final wardrobe detail and complete reference directions', () => {
  const description = 'Adult wearing a field coat. ' + 'The woven fabric has distinct fibers. '.repeat(50) + 'A triangular brass clasp sits at the right cuff.';
  const source = buildCharacterBiblePrompt({name:'Aster',description});
  const prompt = buildMidjourneyPrompt(source,{hasStyleReference:true});
  assert.match(prompt,/triangular brass clasp sits at the right cuff/);
  assert.ok(prompt.endsWith('no text or labels'));
  assert.doesNotMatch(prompt,/\.\.\.$/);
});

test('boolean MJ flags never consume the next descriptive word during cleanup', () => {
  const prompt = buildMidjourneyPrompt('A quiet courtyard --raw copper lanterns beside the door --v 6.1', {hasPeople:false});
  assert.match(prompt,/copper lanterns/);
  assert.doesNotMatch(prompt,/--raw|--v/);
});

test('minimal Imagine payload leaves optional tuning at defaults and retains explicit style weight zero', () => {
  const payload = buildMidjourneyImaginePayload({prompt:'An empty stone courtyard.',aspectRatio:'1:1',hasPeople:false,references:{styleReferenceUrl:'https://example.com/style.png',styleWeight:0}});
  assert.deepEqual(Object.keys(payload).sort(),['prompt','raw','size','sref','sw','version']);
  assert.equal(payload.version,'8.2');
  assert.equal(payload.sw,0);
});
