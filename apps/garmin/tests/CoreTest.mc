import Toybox.Lang;
import Toybox.Test;

(:test)
function clockFormatsUtcTimestamps(logger as Logger) as Boolean {
    Expect.equal(Clock.isoUtc(0), "1970-01-01T00:00:00Z");
    Expect.equal(Clock.isoUtc(1762731005), "2025-11-09T23:30:05Z");
    return true;
}

(:test)
function clockLocalDateUsesTheGivenOffset(logger as Logger) as Boolean {
    var lateEvening = 1794267000; // 2026-11-09T23:30:00Z
    Expect.equal(Clock.localDate(lateEvening, 0), "2026-11-09");
    Expect.equal(Clock.localDate(lateEvening, 60), "2026-11-10");
    Expect.equal(Clock.localDate(lateEvening, -300), "2026-11-09");
    return true;
}

(:test)
function clockOffsetIsWithinWorldRange(logger as Logger) as Boolean {
    var offset = Clock.utcOffsetMinutes();
    Test.assert(offset >= -840 && offset <= 840);
    Test.assert(Clock.nowUtcSeconds() > 1700000000);
    return true;
}

(:test)
function uuidIsRandomVersion4(logger as Logger) as Boolean {
    var a = Uuid.v4();
    var b = Uuid.v4();
    logger.debug("uuid " + a);
    Test.assert(Uuid.isV4(a));
    Test.assert(Uuid.isV4(b));
    Test.assert(!a.equals(b));
    return true;
}

(:test)
function uuidCheckRejectsOtherShapes(logger as Logger) as Boolean {
    Test.assert(Uuid.isV4("3b241101-e2bb-4255-8caf-4136c566a962"));
    Test.assert(!Uuid.isV4("3B241101-E2BB-4255-8CAF-4136C566A962"));
    Test.assert(!Uuid.isV4("3b241101-e2bb-1255-8caf-4136c566a962"));
    Test.assert(!Uuid.isV4("3b241101-e2bb-4255-7caf-4136c566a962"));
    Test.assert(!Uuid.isV4("3b241101e2bb42558caf4136c566a962"));
    return true;
}

(:test)
function capabilitiesDescribeTheDevice(logger as Logger) as Boolean {
    var part = Capabilities.partNumber();
    logger.debug("part " + part + " fw " + Capabilities.firmware() + " size " + Capabilities.screenSize()
        + " amoled " + Capabilities.isAmoled() + " lang " + Capabilities.languageCode());
    Test.assert(part.length() > 0);
    Test.assert(Capabilities.canUseNetwork());
    Test.assert(Capabilities.screenSize() >= 218);
    var lang = Capabilities.languageCode();
    Test.assert(lang.equals("de") || lang.equals("en"));
    return true;
}
