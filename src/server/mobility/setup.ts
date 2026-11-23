/**
 * The mobility answer of the setup, handed to the mobility service as an
 * ordinary `update_mobility_profile` write once the setup is finished.
 *
 * Nothing here touches a table: the mobility service checks the caller and
 * the request id like for any other profile write. The answer "no" is stored
 * as well, so the question is never asked again.
 */
import type { MobilityPreference } from "../../shared/mobility-contract.js";
import type { MobilityService } from "./service.js";

/**
 * Writes the setup's mobility answer into the user's profile. The request id
 * comes from the onboarding session, so finishing the setup twice (a retry
 * after an interrupted finish) replays the same write instead of writing
 * again, and an answer changed in the chat afterwards is never overwritten by
 * the replay. An answer equal to the stored one writes nothing.
 */
export async function recordSetupMobilityProfile(
  mobility: Pick<MobilityService, "updateProfile">,
  preference: MobilityPreference,
  onboardingSessionId: string,
  context: unknown,
): Promise<void> {
  const response = await mobility.updateProfile(
    {
      request_id: `setup-mobility-${onboardingSessionId}`,
      preference,
    },
    context,
  );
  if (!response.ok)
    throw new Error(
      response.error?.message ?? "Mobility-Angaben nicht gespeichert.",
    );
}
