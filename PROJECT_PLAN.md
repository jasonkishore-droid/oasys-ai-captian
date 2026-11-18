# OASYS AI Captain: Project Plan

**Duration:** 14 working days, Thu 12 Nov to Fri 27 Nov 2026 (Monday to Saturday)
**Team:** 2 developers working with Claude Code
**Companion file:** `WBS.xlsx` (task list, timetable, summary, bug log)

---

## 1. Project summary

OASYS AI Captain is a restaurant system for **Oasys Restaurant (Chennai)**. A tablet "waiter" sits on each dining table, recognises guests, talks with them out loud and takes their orders. It connects to a stock and billing backend and prints bills on an OASYS P10 terminal.

### Modules

| Module | Stack | Purpose |
|---|---|---|
| **The Captian** (active) | React + Vite + Three.js, Node server, Python sidecars | Tablet waiter. YOLO, YuNet and SFace run in the browser for people and face recognition. Gemini Live handles voice ordering. Keeps an open tab per table |
| **AI Captian** | Same base | Older version of The Captian. To be merged in and archived |
| **Stock Management** | Express 5 + Knex + React, SQLite/Postgres | Ingredients, recipes, purchases and GST billing. Selling a dish deducts its stock |
| **Menue Card** | React + react-pageflip + Three.js | Guest-facing menu book with 203 dishes. The source of the menu data |
| **Oasys Restaurant Print** | Android (Gradle, JDK 17) | Takes bills from Stock Management over Bluetooth LE and prints them on the P10 |

### End-to-end flow

```
Guest sits ─► Tablet recognises the guest (with consent) ─► Voice or touch order
   ─► Round added to the open tab ─► Kitchen Display Screen ─► Status sent back to the tablet
   ─► Tab closed (split bill if needed) ─► Bill in Stock Management (stock deducted, GST)
   ─► Payment (cash / UPI QR / card) ─► Receipt (print / email / QR / WhatsApp / SMS)
```

### Goals for this plan
1. Merge the codebases into one Captain app and stabilise it.
2. Make the core restaurant flow work end to end: order, kitchen, bill, payment, print.
3. Add manager screens and growth features: dashboard, floor view, loyalty, offers.
4. Ship a deployed release candidate on Fri 27 Nov.

---

## 2. Feature list

**How the hours were estimated:** they assume Claude Code writes most of the code. What's left is prompting, reviewing, testing on real devices (tablet, camera, BLE printer) and fixing. Claude Code saves little time on hardware testing, outside approvals or checking data by hand.

**Legend:** ✅ high feasibility · 🟡 medium · 🟠 partly blocked by something outside the team

| # | ID | Feature | Phase | Difficulty | Feasibility | Est. hrs | Depends on | Notes / risk |
|---|---|---|---|---|---|---|---|---|
| 0a | P0 | Finish the MenuCarousel rework and commit it | 0 Stabilise | Easy | ✅ | 3 | – | Already in progress |
| 0b | P0 | Merge AI Captian into The Captian and archive the old folder | 0 Stabilise | Medium | ✅ | 5 | 0a | |
| 0c | P0 | Shared dev setup and `.env.example` | 0 Stabilise | Easy | ✅ | 2 | – | |
| 1 | F10 | Live sold-out sync | 1 Foundations | Easy | ✅ | 4 | P0 | Data already in Stock Management |
| 2 | F17 | Face ID consent and data deletion | 1 Foundations | Easy–Med | ✅ | 6 | P0 | Must come before F24 and F26 |
| 3 | F3 | Dietary and allergy filters | 1 Foundations | Medium | ✅ | 9 | P0 | ⚠️ A person must check the allergen tags |
| 4 | F22 | Special requests ("less oil") on the kitchen ticket | 1 Foundations | Easy | ✅ | 4 | – | |
| 5 | F6 | Call waiter / help | 1 Foundations | Easy | ✅ | 3 | – | Alerts show on the KDS |
| 6 | F9 | Kitchen Display Screen (KDS) | 2 Kitchen | **Hard** | ✅ | 16 | F22 | Needs real-time updates (SSE or WebSocket) |
| 7 | F7 | Order status on the tablet | 2 Kitchen | Medium | ✅ | 6 | F9 | |
| 8 | F20 | Wait-time estimate | 2 Kitchen | Medium | 🟡 | 6 | F9 | Simple rules first, then use history |
| 9 | F11 | Low-stock alerts and purchase suggestions | 2 Kitchen | Medium | ✅ | 6 | F10 | |
| 10 | F5 | Split bill | 3 Billing | Med–Hard | ✅ | 10 | P0 | ⚠️ GST rounding must match `shared/billing.mjs` |
| 11 | F13 | UPI QR at the table | 3 Billing | Medium | 🟡 | 6 (+8) | F5 | A static QR is easy. Automatic payment confirmation needs a payment gateway account |
| 12 | F15 | Multi-channel receipts (email, QR download, print, WhatsApp, SMS) | 3 Billing | Med–Hard | 🟠 | 12 | F5 | WhatsApp needs Meta Business API approval. SMS needs DLT registration |
| 13 | F12 | Multi-table floor view | 4 Manager | Medium | ✅ | 8 | F6, F9 | |
| 14 | F14 | Sales dashboard | 4 Manager | Medium | ✅ | 8 | – | |
| 15 | F24 | Loyalty points | 5 Growth | Medium | ✅ | 10 | F17 | Linked to the phone number. Face ID only with consent |
| 16 | F25 | Offers and happy-hour pricing | 5 Growth | Medium | ✅ | 8 | F5 | ⚠️ Changes the bill maths, so re-test GST |
| 17 | F4 | Recommendations and upsell | 5 Growth | Medium | ✅ | 8 | F3, F10 | Must respect the dietary filters and sold-out dishes |
| 18 | F26 | Birthday / occasion greeting | 5 Growth | Easy–Med | 🟡 | 4 | F17, F24 | Date of birth comes from the profile, never inferred from the face |
| 19 | F8 | Feedback and rating | 5 Growth | Easy | ✅ | 4 | – | |
| 20 | F23 | Combo / thali builder | 6 Delight | Medium | ✅ | 8 | F3 | |
| 21 | F18 | 3D dish preview | 6 Delight | Easy–Med | 🟡 | 5 | – | **Stretch.** Reuses `Dish3D.jsx` |
| 22 | F19 | Kids mode | 6 Delight | Medium | ✅ | 8 | F3 | **Stretch.** Turned on by hand, not detected by the camera |
| 23 | F21 | Table games / trivia | 6 Delight | Easy–Med | ✅ | 6 | – | **Stretch** |
| 24 | QA | End-to-end testing, bug fixes, deploy | 7 Release | Medium | ✅ | Daily + D7 + D14 | All | |

**Planned feature work:** about 156 hours, plus about 38 hours of bug fixing and testing. The stretch goals add 19 hours, and payment-gateway confirmation adds 8 more.

---

## 3. Daily routine

| Time | Block |
|---|---|
| 09:30 – 09:45 | Standup: yesterday, today, blockers |
| 09:45 – 13:00 | Feature block 1 |
| 13:00 – 14:00 | Lunch |
| 14:00 – 16:45 | Feature block 2 |
| 16:45 – 17:45 | Bug-fix block: the day's bugs, regressions, and reviewing each other's PRs |
| 17:45 – 18:00 | Review, commit, update `WBS.xlsx` |

Days 7 and 14 are release days: features in the morning, then end-to-end testing, bug fixes and a demo in the afternoon.

---

## 4. Sprint 1: core restaurant flow (Thu 12 Nov – Thu 19 Nov)

Sprint 1 runs on two parallel tracks:
- **Teammate A: tablet and guest UI** (The Captain frontend)
- **Teammate B: backend, kitchen and billing** (Captain server and Stock Management)

Each person does about 6 hours of features and 1 hour of bug fixing a day. 🐞 marks the bug-fix block.

| Day | Teammate A: tablet and guest UI | Teammate B: backend, kitchen and billing | Handoffs between you |
|---|---|---|---|
| **D1** Thu 12 Nov | **P0** finish the carousel and commit it by 13:00 (3) · **P0** dev setup and `.env.example` (2) · **F3** draft dietary tags for 203 dishes with Claude (1)<br>🐞 Run The Captain test suites and log failures | **P0** merge AI Captian into The Captian, after A's carousel commit (5) · **F10** sold-out sync, start (1)<br>🐞 Run the Stock Mgmt API tests and check the Vite config changes<br>📋 Apply for WhatsApp Business, SMS DLT and a payment gateway | A commits the carousel **before** B merges, to avoid conflicts in `App.jsx` |
| **D2** Fri 13 Nov | **F3** filter UI on the carousel and order card (6)<br>🐞 Fix the Captain test failures from D1 | **F10** finish the sold-out sync (3) · **F22** special requests: ticket field and voice tool (3)<br>🐞 Fix merge regressions | B shares the sold-out event format |
| **D3** Sat 14 Nov | **F3** voice filter ("no onion", "Jain") (2) · **F17** consent screen UI (4)<br>🐞 Carousel and UI bugs | **F22** finish (1) · **F9** KDS: ticket model, stations, real-time channel (5)<br>🐞 Special-request edge cases | 👤 Allergen tags go to the restaurant owner for sign-off |
| **D4** Mon 16 Nov | **F17** face data deletion and opt-out (2) · **F6** call-waiter button and voice intent (3) · **F7** order-status UI against mock events (1)<br>🐞 F3 filter edge cases | **F9** KDS screen: ticket cards, timers, F6 call-waiter alerts (6)<br>🐞 Real-time reconnect bugs | Agree the KDS status event format |
| **D5** Tue 17 Nov | **F13** UPI QR on the tablet: static QR with the bill amount (5) · **F7** status timeline (1)<br>🐞 Consent flow bugs | **F9** bump/ready, plus status events sent to the tablet (5) · **F5** split-bill API contract (1)<br>🐞 Duplicate tickets on the KDS | Agree the split-bill API contract at standup |
| **D6** Wed 18 Nov | **F7** connect to live KDS events (4) · **F5** split-bill UI, start (2)<br>🐞 Order-status sync bugs | **F5** split logic and GST per split, using `shared/billing.mjs` (4) · **F11** low-stock alerts, start (2)<br>🐞 Tab persistence bugs | B's split API is ready by lunch |
| **D7** Thu 19 Nov | **AM:** **F5** split-bill UI, finish (3) · **F13** QR for each split (1) | **AM:** **F11** low-stock alerts and purchase suggestions, finish (4) | **PM, together:** end-to-end test from seat to print · GST tests · fix critical bugs · **Sprint 1 demo** |

### Sprint 1 load

| | Teammate A | Teammate B |
|---|---|---|
| Feature hours | 40 | 40 |
| Bug-fix hours | 6 + D7 PM | 6 + D7 PM |
| Features | P0 carousel and setup, F3, F17, F6, F7, F13, F5 (UI) | P0 merge, F10, F22, F9, F5 (logic), F11 |

### Dependencies to watch
- **F7 (A) needs F9 (B)** by the end of D5. A builds against mock events until then.
- **F5 UI (A) needs the F5 API (B)** by lunch on D6.
- **F6 call waiter (A)** shows its alerts on B's KDS. That's part of B's D4 work.
- **Cross-review:** each person reviews the other's PR in the 16:45 bug-fix block before it's merged.

---

## 5. Sprint 2: manager screens, growth and polish (Fri 20 Nov – Fri 27 Nov)

Sprint 2 is planned for the whole team. It hasn't been split per teammate yet.

| Day | Date | New features (team hrs) | Bug-fix block focus | End-of-day result |
|---|---|---|---|---|
| D8 | Fri 20 Nov | **F15** multi-channel receipts: email, QR, print. WhatsApp and SMS behind a switch (12) | Bugs carried over from the Sprint 1 end-to-end run | Receipts go out through 3 or more channels |
| D9 | Sat 21 Nov | **F20** wait-time estimate (6) · **F12** floor view, start (6) | Receipt layout on the P10 printer | Guests see an ETA |
| D10 | Mon 23 Nov | **F12** finish (2) · **F14** sales dashboard (8) · **F8** feedback, start (2) | Floor view real-time bugs | Manager sees the floor and sales |
| D11 | Tue 24 Nov | **F8** finish (2) · **F24** loyalty points (10) | Check dashboard numbers against Stock Mgmt reports | Points earned on each bill |
| D12 | Wed 25 Nov | **F25** offers and happy-hour pricing (8) · **F26** birthday greeting (4) | Loyalty edge cases. Re-test GST after offers | Time-based offers apply to bills |
| D13 | Thu 26 Nov | **F4** recommendations and upsell (8) · **F23** thali builder, start (4) | Offer and GST regressions. Check that recommendations respect the filters and sold-out dishes | Upsell suggestions work by voice |
| D14 | Fri 27 Nov | **F23** finish (4) | **Release day:** full end-to-end test, fix bugs, production build, deploy over LAN/HTTPS, update the README. **Final demo** | Release candidate deployed |

---

## 6. Stretch goals

Pull these in only if a day finishes early:

| ID | Feature | Hrs |
|---|---|---|
| F18 | 3D dish preview | 5 |
| F19 | Kids mode | 8 |
| F21 | Table games / trivia | 6 |
| F13+ | Payment-gateway auto-confirmation, once the account is approved | 8 |

---

## 7. Checkpoints

| Day | Checkpoint |
|---|---|
| D1 | Applications sent for WhatsApp Business, SMS DLT and the payment gateway |
| D4 | Allergen data signed off by the restaurant owner |
| D7 | Sprint 1 demo of the core flow. Go/no-go decision for Sprint 2 |
| D12 | GST re-checked after the split-bill and offer changes |
| D14 | Release candidate deployed. Final demo |

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| WhatsApp, SMS DLT or payment-gateway approval is slow | Parts of F13 and F15 can't go live | Apply on D1. Ship email, QR and print first. Put WhatsApp and SMS behind a switch |
| Wrong allergen tags (F3) | Could harm a guest | The restaurant owner signs off by D4 |
| GST errors after split bills or offers | Wrong bills and tax totals | Use only `shared/billing.mjs`. Add GST tests on D7 and D12 |
| KDS real-time work (F9) runs late | All of phase 2 slips | Agree the event format early. Tablet work builds against mocks |
| Merge conflicts between the two tracks | Lost time | Commit the carousel before the merge. Small PRs every day with cross-review |
| Testing on real devices (camera, BLE printer, tablet) | Bugs only show up on hardware | Test on the real tablet and P10 on D7 and D14 |
| Face ID privacy | Legal and guest-trust problems | F17 consent comes first. No face-based guessing of age or birthday |
