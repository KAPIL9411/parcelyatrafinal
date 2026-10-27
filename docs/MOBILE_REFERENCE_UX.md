# Mobile reference study — what the shipped APKs actually show

Scope: static inspection of the two supplied APKs for observable UX patterns only. No proprietary
code, assets, copy or private APIs are reproduced in Parcel Yatra; the findings below are interaction
patterns, re-expressed in Parcel Yatra's own identity.

## Artifacts and method

| Supplied file | SHA-256 | Result |
|---|---|---|
| `rapido-bike-taxi-auto.apk` | `cd3a042bb2135040024cdd4e7b0dfd5f2db950e6fc111f529b5e5887fbf7fc47` | **Not Rapido.** 0 occurrences of "rapido" in `classes.dex`; 1,380 of "aptoide"; manifest declares `com.aptoide.android.aptoidegames.AptoideApplication`. It is the Aptoide store client. |
| `porter-delivery-partner-attach-mini-truck-bike.apk` | `1382a85bd3cf8d646a2f9636620b82bcd133eecdb44c42c570aad76f1d38aaa0` | Porter delivery-partner app, `com.theporter.android.driverapp`, 4,534 archive entries. |

REA evidence: artifact summaries `ev_6270d82f76000e7db89030bee754e0bde021b16640b028f18c0a10aa3d88a858`
(Rapido/Aptoide) and `ev_58d3a25f077c817b3cbe84c73776672969782b2be7ff9b4b71902252783c7f3c` (Porter);
inventory parents `ev_e9118c6de3b04cdf813d49a0db7b950ef6fa397b85ab9a15de6f27fb085828a1` and
`ev_0b2078abcab74db7ccb38929b3b633d6134775b99622bbeb0a776f275d687f9a`. Both inventories are
complete-within-view; they do not establish runtime behaviour.

Method and its limits:

- REA's Android code route (`inspect_android_package`, JADX) is **unavailable here**: no JDK on PATH
  and no caller-supplied `jadx-headless-mcp` JAR. REA setup does not install either, so the route is
  blocked, not skipped by choice.
- What was possible without JADX: REA's archive route for identity, digests and member inventory;
  Porter's resource table and manifest were read directly (Porter is not resource-obfuscated), which
  yields real layout names, component names, permissions and UI strings. Rapido's resources are
  name-obfuscated (AndResGuard) *and* the file is the wrong app, so nothing is claimed from it.
- Static strings and layout names are *declarations*, not observed screens. No emulator, device or
  account was used against either app. Rapido's flow below is therefore marked **public evidence**,
  taken from the app's public product descriptions, not from the supplied binary.

## Porter (delivery partner) — what the shipped app declares

Component names (manifest, un-obfuscated): `ui.main_activity.MainActivity` (RIBs root), `RootActivity`,
`ui.profile.ProfileActivity`, `ui.wallet.platform.WalletV2Activity`, `ui.earnings.platform.EarningsActivity`,
`mvp.referral.platform.ReferralActivity`, `mvp.training.platform.TrainingActivity`,
`ui.guide.list.GuideListActivity`, `ui.guide.slides.GuideSlidesActivity`, `mvp.lead.platform.LeadsActivity`,
`mvp.html_view.HtmlViewActivity`, `video.VideoActivity`, `services.heartbeat.HeartbeatService`,
`services.checker.CheckerService`, `services.payout.PayoutService`, `services.apk.ApkDownloader`.

Permissions: fine/coarse location, foreground service, network state, wake lock, call phone, contacts,
overlay, external storage, install packages, receive boot completed.

Screen inventory (layout files, app-owned only): onboarding (`onboarding_fragment`, `owner_onboarding_fragment`,
`onboarding_step_row`, language selection), registration + OTP (`registration_fragment_v2`, `otp_fragment_v2`,
`rib_registration_number`, `rib_otp`), go-online (`layout_go_online`, `online_fragment`, `online_home`,
`layout_go_online_blocked_waitlisted`, `layout_go_online_blocked_generic_reason`, `online_no_gps`,
`online_no_network`), order intake (`online_order_alert_overlay`, `partial_accept_order_v2`,
`partial_swipe_button`, `accept_timer`, `partial_surge_accept`), active trip (`order_details`, `order_waiting`,
`order_trip_summary`, `order_request_otp_dialog`, `order_odometer`, `order_split`), earnings
(`earnings_fragment`, `fragment_earnings_v2`, `fragment_order_earning_details_v2`, `earnings_cycle_selector`,
`earnings_period_card`), wallet (`fragment_wallet_v2`, `partial_wallet_balance_v4`,
`partial_wallet_withdraw_v2`, `partial_wallet_transaction_{pending,successful,failed}`), documents
(`fragment_document_upload`, `fragment_documents_mandatory`, `partial_branding_document_upload`,
`pending_documents_reminder_card`), training (`fragment_training`, `guide_card`, `guide_slide`,
`visual_training_view`, `home_active_training_step_card`), profile/help (`fragment_profile`, `help_fragment`,
`fragment_contact`, `chat_fullscreen_*`, `chat_minimized_*`), referral (`fragment_referral`,
`referral_view`).

Declared flow copy (resource values, English; other locales omitted):

- status: `You are ONLINE` / `You are OFFLINE` / `You are suspended`, `Failed to go online`,
  `Please ensure you are online`.
- onboarding: `#. Upload documents`, `document_verification_onboarding_step_title`,
  `owner_onboarding_training_step_title`, `Ready to start earning`, `Voila! You are ready to do your first trip`,
  `Get your first trip`, `few_steps_away_from_getting_first_trip`, `Dummy Order`, `Waiting for dummy order`.
- order intake: `Accept`, `Reject`, `Reject reason: %1$s`, `accept_timer`, `accept_within`,
  `Pickup %1$s away`, `Estimated Fare`, `Order details have changed`, `Fare has been updated`.
- trip: `Start Navigation` / `Navigeren naar startpositie`, `REACH A NEARBY LANDMARK`, `Start Trip`,
  `Waiting to auto read OTP`, `Enter OTP manually`, `Enter OTP sent to customer`, `RESEND OTP`,
  `Please enter a valid OTP`, `Collect cash` / `Do not collect cash`, `Cash to Collect`, `End Trip`,
  `Complete trip`, `Please record a signature.`, `Please enter customer rating.`, `Rate the Customer`,
  `Attached photo`, `Reupload Photo`.
- failures: `No Network`, `No Network Response`, `GPS Location Not Found`, `Permission not granted`,
  `map_error_placeholder`, `map_loading_placeholder`, `partial_error_fare_details_fetch_failed`,
  `Orders Missed`, `order_waiting`.
- earnings/wallet: `Daily Earnings`, `Monthly Earnings`, `Earnings break-up`, `Trip Incentive`,
  `Outstation Trips`, `Withdrawable amount`, `Minimum wallet balance %1$s`, `Add money to avoid suspension`,
  `Pending transactions`, `Download Payslip`.

Patterns worth adopting (re-expressed, not copied):

1. **A single online/available switch is the traveller's home anchor**, with three explicit states
   (available, unavailable-with-reason, blocked-with-reason) rather than a silent empty list.
2. **A step list for onboarding**, one row per requirement, each independently completed/rejected/pending,
   with the next action on the row. It removes the "why can't I accept orders" dead end.
3. **Order intake is a timed card**: route, distance to pickup, fare, a deliberate accept gesture, and
   an explicit reject with a reason. Expiry is a first-class state (`Orders Missed`).
4. **The trip screen is task-first**: one primary next action (navigate → arrive → verify OTP → collect
   → complete), with the map as context rather than the screen.
5. **OTP is dual-channel**: read the SMS automatically when allowed, always offer manual entry and resend.
6. **Cash vs prepaid is a decision on the trip**, with "do not collect cash" as a first-class button
   rather than a footnote.
7. **Failure states are named by cause**: no network, no GPS, no permission, fare fetch failed, each with
   its own recovery, instead of one generic error.
8. **Money gets its own tab** with a period selector and a break-up per trip; pending vs settled is visible.
9. **Support is reachable from every screen** via a persistent chat entry, not only from a help page.
10. **Language selection happens before first use**, not buried in settings.

Patterns deliberately not adopted: surge/incentive gamification, wallet top-ups and cash collection
(Parcel Yatra's pilot has no payout rail), dummy orders, install-package prompts, referral economics
and ad/upsell surfaces.

## Rapido — public evidence only

The supplied file cannot support any claim about Rapido. The pattern set Parcel Yatra borrows from
public descriptions of the rider flow is: two-field pickup/destination entry with a confirm-on-map step,
a service/vehicle choice with fare and ETA shown together, an explicit "finding a captain" state with
cancel, a start OTP, a live-trip screen dominated by the next action and safety affordances, and a
post-trip rating. Nothing here is presented as binary-derived.

## Consequences for the Parcel Yatra mobile app

- The app is **role-aware**: the sender side mirrors the booking wizard already on the web; the
  traveller side takes the Porter structure (availability switch, step list, opportunity card, trip
  task screen) without Porter's money/surge surfaces.
- No new backend capability is implied by a reference. Every screen maps to an endpoint that exists in
  `apps/api/src/routes`; anything the references show but the API cannot do (live GPS tracking, wallet,
  auto-read SMS OTP, signature capture) is left out rather than faked.
- Brand, type and colour come from the web app's own tokens, not from either reference.

## What the app implements today

| Reference pattern | Where it landed | What was left out |
| --- | --- | --- |
| Task-first trip screen (Porter) | `app/trips/[id].tsx`: route, status, capacity, meeting point, offers, edit/cancel | No map, no navigation, no "start trip" driver mode |
| Timed order intake card (Porter) | Opportunity cards in the trip screen: route, window, weight, sender verification, "Your share is set when a sender books you" | No accept countdown — the API has no offer expiry, so a timer would be invented |
| Step list for onboarding (Porter) | Verification screen: one state per requirement, reason codes, attempt budget, next action | No automatic document reading; a person reviews |
| OTP dual-channel (Porter) | Handover codes in `app/bookings/[id].tsx`, manual entry and regenerate | No SMS auto-read; the API delivers the code in-app |
| Named failure states (Porter) | `ApiError` codes mapped to copy on every screen; matching reasons named instead of an empty list | No "no GPS" state, because nothing asks for GPS |
| Money tab (Porter) | Booking price and payout eligibility line only | No wallet, earnings tab, cash collection or payouts — the API refuses them |
| Support from anywhere (Porter) | Support route inside a booking, plus a public Help screen | No persistent chat widget; no published grievance address exists to show |
| Confirm route + price before booking (Rapido, public evidence) | Send wizard: quote is server-computed and shown before the match list | No map pin, no live captain location |

All of it is honest about the pilot: the screens say what the server can and cannot do rather than
filling the gaps with demo behaviour.
