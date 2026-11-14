/**
 * Seeds platform Activity templates (createdBy: null, isTemplate: true).
 * Safe to run multiple times — upserts by { name, createdBy: null }.
 *
 * Usage (from server/): node src/seeders/seedActivityTemplates.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/database.js');
const Activity = require('../models/Activity.js');

const PLATFORM_SEEDS = [
  {
    name: 'Name Calling Game',
    domain: 'Speech',
    objective: 'Increase orienting and responding when the child’s name is spoken.',
    procedure:
      'Say the child’s name from 1–2 m; pause 2–3 s; reinforce any look, turn, or vocal response. Fade prompts gradually.',
    instructions:
      'Use a calm voice. Pair success with a brief preferred reinforcer. Keep trials short (8–10 per round).',
    notes: '',
    materials: 'Preferred items, quiet space',
    difficulty: 'Easy',
    frequency: '3–5 trials per session',
    parentInvolvement: true,
  },
  {
    name: 'Object Naming Game',
    domain: 'Speech',
    objective: 'Label common objects on request with increasing independence.',
    procedure:
      'Present two objects; ask “What is this?”; model if needed; reinforce correct labels. Increase set size as skills grow.',
    instructions: 'Keep contrast high between choices. Accept approximations then shape toward clear labels.',
    notes: '',
    materials: 'Everyday objects or picture cards',
    difficulty: 'Medium',
    frequency: 'Daily, 10 trials',
    parentInvolvement: true,
  },
  {
    name: 'Sound Imitation Practice',
    domain: 'Speech',
    objective: 'Imitate early speech sounds and syllable shapes.',
    procedure:
      'Model one sound; wait; reinforce any matching attempt. Add visual cues if helpful. Track sounds mastered.',
    instructions: 'Mirror face-to-face. Reinforce effort, then accuracy.',
    notes: '',
    materials: 'Mirror (optional), reinforcers',
    difficulty: 'Medium',
    frequency: '5–10 minutes, 3–4×/week',
    parentInvolvement: true,
  },
  {
    name: 'Pencil Grip Practice',
    domain: 'OT',
    objective: 'Develop functional tripod or quadrupod grip for pre-writing.',
    procedure:
      'Use short crayon/chalk; practice vertical and circular strokes on easel or paper. Hand-over-hand as needed, then fade.',
    instructions: 'Short sessions; stop before fatigue. Praise correct grip moments.',
    notes: '',
    materials: 'Short pencils/crayons, easel or slant board',
    difficulty: 'Easy',
    frequency: '5 min daily',
    parentInvolvement: true,
  },
  {
    name: 'Buttoning Shirt',
    domain: 'OT',
    objective: 'Sequence fine motor steps to fasten large buttons independently.',
    procedure:
      'Start with large buttons on a vertical board; verbalize steps; practice bottom-up on real shirt when ready.',
    instructions: 'Use contrasting fabric; verbal chaining (“pinch, push, pull”).',
    notes: '',
    materials: 'Dressing board or practice shirt with large buttons',
    difficulty: 'Hard',
    frequency: '2–3×/week',
    parentInvolvement: true,
  },
  {
    name: 'Sand Play',
    domain: 'Sensory',
    objective: 'Regulate arousal and tolerate tactile input through structured sand exploration.',
    procedure:
      'Offer dry or kinetic sand; hide objects to find; follow child’s lead with gentle scaffolding.',
    instructions: 'Have wipes nearby. Offer choice of tools (scoops, molds).',
    notes: '',
    materials: 'Tray, sand, tools, hidden objects',
    difficulty: 'Easy',
    frequency: '1–2×/week',
    parentInvolvement: true,
  },
  {
    name: 'Swing Activity',
    domain: 'Sensory',
    objective: 'Provide linear vestibular input to support regulation and attention.',
    procedure:
      '10–15 slow linear swings; stop every 3–5 reps to check regulation. Pair with deep breathing if appropriate.',
    instructions: 'Watch for signs of over-arousal. Stop if dizziness or discomfort.',
    notes: '',
    materials: 'Approved swing setup, supervision',
    difficulty: 'Medium',
    frequency: 'As per sensory plan',
    parentInvolvement: false,
  },
  {
    name: 'Reinforcement Training',
    domain: 'Behavioral (ABA)',
    objective: 'Strengthen appropriate behaviors through contingent reinforcement.',
    procedure:
      'Identify target behavior; deliver reinforcer immediately after behavior; thin schedule gradually per BCBA guidance.',
    instructions: 'Keep reinforcer potent; avoid accidental reinforcement of problem behavior.',
    notes: '',
    materials: 'Reinforcer menu, data sheet',
    difficulty: 'Medium',
    frequency: 'Per behavior plan',
    parentInvolvement: true,
  },
  {
    name: 'Task Chaining',
    domain: 'Behavioral (ABA)',
    objective: 'Teach multi-step routines using forward or backward chaining.',
    procedure:
      'Break task into steps; teach one step at a time; prompt hierarchy as needed; collect trial data.',
    instructions: 'Use task analysis; minimize verbal overload during chaining.',
    notes: '',
    materials: 'Visual schedule, materials for task',
    difficulty: 'Hard',
    frequency: 'Daily practice of target chain',
    parentInvolvement: true,
  },
  {
    name: 'Picture Exchange',
    domain: 'AAC',
    objective: 'Request preferred items by exchanging a picture icon.',
    procedure:
      'Place icon within reach; prompt reach and hand-off; deliver item immediately. Fade prompts systematically.',
    instructions: 'Start with highly preferred items and short distance.',
    notes: '',
    materials: 'PECS book or board, icons, reinforcers',
    difficulty: 'Medium',
    frequency: 'Multiple trials daily',
    parentInvolvement: true,
  },
  {
    name: 'Symbol Matching',
    domain: 'PECS',
    objective: 'Match symbols to objects or photos to build symbolic understanding.',
    procedure:
      'Present array of 2–4 symbols; ask to match to sample; reinforce correct matches.',
    instructions: 'Increase array size as accuracy improves.',
    notes: '',
    materials: 'Symbol set, laminates, Velcro',
    difficulty: 'Easy',
    frequency: '10 trials, 4×/week',
    parentInvolvement: true,
  },
];

async function run() {
  await connectDB();
  let upserted = 0;
  for (const row of PLATFORM_SEEDS) {
    await Activity.findOneAndUpdate(
      { name: row.name, createdBy: null },
      {
        $set: {
          ...row,
          isTemplate: true,
          createdBy: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upserted += 1;
  }
  console.log(`Activity library: ensured ${upserted} platform template(s).`);
  await mongoose.disconnect();
  process.exit(0);
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { PLATFORM_SEEDS };
