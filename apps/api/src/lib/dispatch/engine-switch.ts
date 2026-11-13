import { isDemoCampaign } from '../demo.js';

import { type DbExecutor } from './pool.js';

// DISP-TOURS (Mariem, 03/11/2026) — which engine prices, launches and places a NEW standard
// campaign: the tours engine (lib/dispatch/tours — each venue's 2 peak hours of every weekday,
// tour after tour) or v1 (one SPS-ordered venue at a time, a uniform r_i on every hour). One line
// to roll back; a frozen plan keeps the engine that froze it (campaign_dispatch_plan.engine), so
// flipping this never touches a launched campaign.
//
// DEMO-1 — a demo screencaster's campaign stays on v1: a demo must air minutes after the launch
// (the prospect watches it on the demo venue), not at the venue's next peak hour.

const TOURS_ENGINE_ON = true;

/** The engine switch itself (tests pin v1 rules by mocking this module). */
export const toursEngineOn = (): boolean => TOURS_ENGINE_ON;

/** Does THIS campaign go through the tours engine? */
export const usesToursEngine = async (executor: DbExecutor, campaignId: string): Promise<boolean> =>
  toursEngineOn() && !(await isDemoCampaign(executor, campaignId));
