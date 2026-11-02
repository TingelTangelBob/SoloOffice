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

Die Anwendung lädt keine Validatoren oder Prüfkonfigurationen zur Laufzeit aus
dem Internet. Der CI-Job lädt für die externe XRechnungsprüfung fest gepinnte
KoSIT-Artefakte und prüft ihre SHA-256-Prüfsummen vor jedem Lauf. Der
GitHub-Actions-Cache darf die Downloads wiederverwenden; auch Cache-Dateien
werden erneut geprüft. Validator, Konfiguration und erzeugte Rechnungen werden
nicht ins Repository übernommen.

Der Job baut drei Beispielrechnungen mit dem Anwendungsgenerator und prüft
Regelbesteuerung mit mehreren Steuersätzen, Kleinunternehmer nach § 19 UStG
sowie einen Auslandskunden mit Sonderzeichen. Er nutzt den offiziellen
[KoSIT-Validator v1.6.3](https://github.com/itplr-kosit/validator/releases/tag/v1.6.3)
und die [XRechnung-Konfiguration v2026-08-31](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31)
für XRechnung 3.0.2. Der Validator benötigt Java 11 oder neuer; die CI nutzt
Java 17. Details zur offiziellen Aufrufsyntax stehen in der
[KoSIT-Konfigurationsdokumentation](https://github.com/itplr-kosit/validator-configuration-xrechnung/blob/master/docs/usage.md).

Der FeRD-/Factur-X-Validator für ZUGFeRD wird weiterhin nicht automatisch
heruntergeladen. Der ZUGFeRD-PDF-Fall aus der manuellen Release-Prüfung bleibt
offen.
