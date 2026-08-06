# E-Rechnungs-Validierung

SoloOffice prüft lokal, ob erzeugtes XRechnung- und ZUGFeRD-XML wohlgeformt ist
und zentrale Pflichtfelder enthält. Das ersetzt keine fachliche Prüfung gegen
die Referenzregeln.

Vor einer produktiven Freigabe sind mindestens diese Fälle mit den offiziellen
Validatoren zu prüfen:

1. Regelbesteuerung mit mehreren Steuersätzen
2. Kleinunternehmerregelung nach § 19 UStG
3. Auslandskunde mit abweichendem ISO-Ländercode
4. Sonderzeichen wie `&`, `<` und `>` in Firmen-, Kunden- und Positionstexten
5. B2G-Rechnung mit Leitweg-ID
6. ZUGFeRD-PDF mit `factur-x.xml`, XMP, ICC-OutputIntent und eingebetteten Schriften

Der KOSIT-Validator (XRechnung) und der FeRD-/Factur-X-Validator (ZUGFeRD)
werden bewusst nicht automatisch aus dem Internet heruntergeladen. Die
Validator-Artefakte und die erzeugten Testdokumente gehören in eine geschützte
CI-/Release-Umgebung und nicht in dieses Repository.
