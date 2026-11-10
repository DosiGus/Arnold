import Toybox.Lang;

// Where the app talks to Arnold. Product builds always use the production
// address; only test builds (:garminGate) take the temporary address from the
// ignored DebugConfig.mc, so a product build never contains a tunnel address.
module AuthConfig {
    const PRODUCTION_URL as String = "https://arnold-789221393068.europe-west1.run.app/api/watch/v1";

    (:garminProduct)
    function baseUrl() as String {
        return PRODUCTION_URL;
    }

    (:garminGate)
    function baseUrl() as String {
        return DebugConfig.URL + "/api/watch/v1";
    }
}
