import Toybox.Lang;

// Model name sent at pairing, so the confirmation card in ChatGPT can say which
// watch it is. The SDK only reveals the part number, so the table maps the
// part numbers of the target devices (SDK device definitions) to names.
module DeviceNames {

    function label(partNumber as String) as String {
        var names = {
            "006-B3992-00" => "Forerunner 255",
            "006-B3993-00" => "Forerunner 255S",
            "006-B3990-00" => "Forerunner 255 Music",
            "006-B3991-00" => "Forerunner 255S Music",
            "006-B4257-00" => "Forerunner 265",
            "006-B4258-00" => "Forerunner 265S",
            "006-B4024-00" => "Forerunner 955",
            "006-B4315-00" => "Forerunner 965",
            "006-B3906-00" => "fenix 7",
            "006-B3909-00" => "fenix 7",
            "006-B3905-00" => "fenix 7S",
            "006-B3908-00" => "fenix 7S",
            "006-B3907-00" => "fenix 7X",
            "006-B3910-00" => "fenix 7X",
            "006-B4135-00" => "fenix 7X",
            "006-B4341-00" => "fenix 7X"
        } as Dictionary<String, String>;
        var name = names[partNumber];
        if (name instanceof String) {
            return name as String;
        }
        return partNumber.length() > 0 ? "Garmin " + partNumber : "Garmin";
    }
}
