import Toybox.Lang;
import Toybox.Position;

typedef GpsOptions as {
    :acquisitionType as Position.LocationAcquisitionType,
    :configuration as Position.Configuration
};

// What the device says about satellite configurations. A seam for tests: they answer for
// a device of their own.
class GpsCapability {
    function initialize() {
    }

    function supports(configuration as Position.Configuration) as Boolean {
        if (!(Position has :hasConfigurationSupport)) {
            return false;
        }
        return Position.hasConfigurationSupport(configuration);
    }
}

// The satellite mode of a run (RUN-025). THE ONE PLACE where it is decided: the order below
// is the only thing to change when Kevin's GPS test runs (RUN-002) show another order is
// better on a watch. The first mode the device supports is used.
//
// Most accurate first: SatIQ (the watch picks the system on its own), then multi-band with
// all systems (GPS, GLONASS, Galileo, BeiDou on L1 and L5), all systems on L1, GPS + Galileo,
// GPS only. A device with none of them (or without the check) gets the system default.
module GpsMode {
    function order() as Array<Position.Configuration> {
        return [
            Position.CONFIGURATION_SAT_IQ,
            Position.CONFIGURATION_GPS_GLONASS_GALILEO_BEIDOU_L1_L5,
            Position.CONFIGURATION_GPS_GLONASS_GALILEO_BEIDOU_L1,
            Position.CONFIGURATION_GPS_GALILEO,
            Position.CONFIGURATION_GPS
        ] as Array<Position.Configuration>;
    }

    // The first mode of `order()` that the device supports, or null.
    function choose(capability as GpsCapability) as Position.Configuration or Null {
        var modes = order();
        for (var i = 0; i < modes.size(); i++) {
            if (capability.supports(modes[i])) {
                return modes[i];
            }
        }
        return null;
    }

    // Options for Position.enableLocationEvents: continuous, with the mode if there is one.
    function options(mode as Position.Configuration or Null) as GpsOptions {
        var out = { :acquisitionType => Position.LOCATION_CONTINUOUS } as GpsOptions;
        if (mode != null) {
            out[:configuration] = mode;
        }
        return out;
    }
}
