/** Versionierte Parameter; Quellenstatus und Grenzen sind Teil des Datensatzes. */
export default {
  "year": 2026,
  "version": "2026.1",
  "asOf": "2026-10-09",
  "provenance": "PLAN.md und Teilrecherchen b/c/d vom 09.10.2026; keine neue Online-Prüfung im netzwerkfreien Auftrag",
  "incomeTax": {
    "basicAllowance": 12348,
    "zone2End": 17799,
    "zone3End": 69878,
    "zone4End": 277825,
    "zone2Quadratic": 914.51,
    "zone2Linear": 1400,
    "zone3Quadratic": 173.1,
    "zone3Linear": 2397,
    "zone3Offset": 1034.87,
    "zone4Rate": 0.42,
    "zone4Offset": 11135.63,
    "zone5Rate": 0.45,
    "zone5Offset": 19470.38,
    "progressionDivisor": 10000,
    "specialExpenseAllowance": 36,
    "singleParentAllowance": 4260,
    "singleParentExtraChild": 240,
    "childAllowancePerParent": 4878,
    "childBenefitMonthly": 259
  },
  "solidarity": {
    "exemptionSingle": 20350,
    "exemptionJoint": 40700,
    "rate": 0.055,
    "mitigationRate": 0.119
  },
  "churchTax": {
    "reducedRate": 0.08,
    "standardRate": 0.09,
    "reducedStates": [
      "BY",
      "BW"
    ],
    "cappingIncluded": false
  },
  "social": {
    "referenceMonthly": 3955,
    "referenceAnnual": 47460,
    "healthCapMonthly": 5812.5,
    "healthCapAnnual": 69750,
    "healthMinimumMonthly": 1318.33,
    "healthGeneralRate": 0.146,
    "healthReducedRate": 0.14,
    "averageAdditionalRate": 0.029,
    "healthCompulsoryAnnual": 77400,
    "careRate": 0.036,
    "careChildlessExtra": 0.006,
    "careChildlessAge": 23,
    "careChildDiscount": 0.0025,
    "careMaximumDiscountChildren": 4,
    "careChildAgeLimit": 25,
    "pensionRate": 0.186,
    "pensionCapMonthly": 8450,
    "pensionCapAnnual": 101400,
    "pensionMinimumBaseMonthly": 603,
    "pensionMinimumMonthly": 112.16,
    "pensionStandardMonthly": 735.63,
    "pensionHalfMonthly": 367.82,
    "pensionMaximumMonthly": 1571.7,
    "pensionFounderCalendarYears": 3,
    "craftExemptionContributionYears": 18,
    "unemploymentMonthly": 102.83,
    "unemploymentFounderMonthly": 51.41,
    "unemploymentFounderYears": 2,
    "unemploymentApplicationMonths": 3,
    "kskMinimumAnnual": 3900,
    "kskFounderYears": 3,
    "kskHealthMinimumMonthly": 325,
    "kskInsuredShare": 0.5,
    "kskLevyRate": 0.049,
    "kskLevyDeMinimis": 1000,
    "kskReportingMonth": 12,
    "kskReportingDay": 1
  },
  "deductions": {
    "pensionMaximumSingle": 30826,
    "pensionMaximumJoint": 61652,
    "otherMaximumSelfEmployed": 2800,
    "otherMaximumSubsidised": 1900,
    "healthSickPayDeductionFactor": 0.96
  },
  "tradeTax": {
    "allowance": 24500,
    "roundingUnit": 100,
    "assessmentRate": 0.035,
    "minimumMultiplierPercent": 200,
    "defaultMultiplierPercent": 441,
    "creditMultiplier": 4
  },
  "vat": {
    "smallBusinessPreviousLimit": 25000,
    "smallBusinessCurrentLimit": 100000,
    "smallBusinessFounderLimit": 25000,
    "warningRatio": 0.8,
    "cashAccountingPreviousLimit": 800000,
    "monthlyAdvanceThreshold": 9000,
    "advanceExemptionThreshold": 2000,
    "standardRate": 19,
    "reducedRate": 7,
    "zeroRate": 0,
    "filingDayAfterPeriod": 10,
    "permanentExtensionMonths": 1,
    "specialPrepaymentDivisor": 11,
    "specialPrepaymentDueMonth": 2,
    "specialPrepaymentDueDay": 10,
    "tenDayRuleDays": 10,
    "founderMonthlySuspendedUntil": 2026,
    "kennzahlen": {
      "kz81": "Steuerpflichtige Umsätze zum Steuersatz von 19 % (Bemessungsgrundlage)",
      "kz86": "Steuerpflichtige Umsätze zum Steuersatz von 7 % (Bemessungsgrundlage)",
      "kz87": "Umsätze zum Steuersatz von 0 % nach § 12 Abs. 3 UStG",
      "kz35": "Umsätze zu anderen Steuersätzen (Bemessungsgrundlage)",
      "kz36": "Steuer zu anderen Steuersätzen",
      "kz48": "Steuerfreie Umsätze ohne Vorsteuerabzug (§ 4 Nr. 8 bis 29 UStG)",
      "kz46": "Sonstige Leistungen eines im übrigen Gemeinschaftsgebiet ansässigen Unternehmers (§ 13b Abs. 1 UStG), Bemessungsgrundlage",
      "kz47": "Steuer zu Kz 46",
      "kz84": "Andere Leistungen (§ 13b Abs. 2 Nr. 1, 2, 4 bis 12 UStG), Bemessungsgrundlage",
      "kz85": "Steuer zu Kz 84",
      "kz66": "Vorsteuerbeträge aus Rechnungen von anderen Unternehmern",
      "kz67": "Vorsteuerbeträge aus Leistungen im Sinne des § 13b UStG",
      "kz39": "Abzug der festgesetzten Sondervorauszahlung für Dauerfristverlängerung",
      "kz83": "Verbleibende Umsatzsteuer-Vorauszahlung bzw. verbleibender Überschuss"
    },
    "euerKennzahlen": {
      "smallBusinessIncome": "111",
      "exemptIncome": "103",
      "taxableIncomeNet": "112",
      "vatCollected": "140",
      "vatRefunded": "141",
      "inputTaxPaid": "185",
      "vatPaidToOffice": "186"
    }
  },
  "chambers": {
    "ihkExemptionProfit": 5200,
    "ihkLevyAllowance": 15340,
    "ihkFounderProfitLimit": 25000,
    "ihkFounderExemptYears": 2,
    "ihkFounderLevyExemptYears": 4,
    "hwkFounderExemptYears": 1,
    "hwkFounderReducedYears": 4,
    "hwkFounderReducedBasicFactor": 0.5,
    "hwkFounderProfitLimit": 25000
  },
  "bookkeeping": {
    "revenueLimit": 800000,
    "profitLimit": 80000
  },
  "advancePayments": {
    "incomeTaxDates": [
      [
        3,
        10
      ],
      [
        6,
        10
      ],
      [
        9,
        10
      ],
      [
        12,
        10
      ]
    ],
    "tradeTaxDates": [
      [
        2,
        15
      ],
      [
        5,
        15
      ],
      [
        8,
        15
      ],
      [
        11,
        15
      ]
    ],
    "incomeTaxMinimumAnnual": 400,
    "incomeTaxMinimumEach": 100
  },
  "forecast": {
    "defaultBandRatio": 0.15,
    "monthsPerYear": 12,
    "marginalStep": 100
  },
  "sources": [
    {
      "id": "est",
      "url": "https://www.gesetze-im-internet.de/estg/__32a.html",
      "covers": [
        "incomeTax"
      ],
      "status": "Primärquelle laut c-RESULT"
    },
    {
      "id": "soli",
      "url": "https://www.gesetze-im-internet.de/solzg_1995/__4.html",
      "covers": [
        "solidarity"
      ],
      "status": "Primärquelle laut c-RESULT; Übergang aus Formel, fehlerhaften Kommentar dort nicht übernehmen"
    },
    {
      "id": "sv",
      "url": "https://www.gesetze-im-internet.de/svbezgrv_2026/BJNR1160A0025.html",
      "covers": [
        "social"
      ],
      "status": "Rechengrößen laut PLAN geprüft; Beitragssätze und Sonderfälle siehe b-RESULT"
    },
    {
      "id": "drv",
      "url": "https://www.deutsche-rentenversicherung.de/SharedDocs/Downloads/DE/Broschueren/national/werte_der_rentenversicherung.html",
      "covers": [
        "social.pension"
      ],
      "status": "PLAN: DRV-Werte Stand 01.07.2026"
    },
    {
      "id": "gkv",
      "url": "https://www.gesetze-im-internet.de/sgb_5/__240.html",
      "covers": [
        "social.health"
      ],
      "status": "Mindestbemessung und Nachfestsetzung; ZB nutzereigen, Durchschnitt aus Recherche"
    },
    {
      "id": "pv",
      "url": "https://www.gesetze-im-internet.de/sgb_11/__55.html",
      "covers": [
        "social.care"
      ],
      "status": "Sätze laut b-RESULT; Altersangabe nur Geburtsjahr, Altersgrenze im Grenzjahr vereinfacht"
    },
    {
      "id": "ksk",
      "url": "https://www.kuenstlersozialkasse.de/kuenstler-und-publizisten/voraussetzungen",
      "covers": [
        "social.ksk"
      ],
      "status": "Recherche b; keine rückwirkende Gewinnabrechnung wie freiwillige GKV"
    },
    {
      "id": "av",
      "url": "https://www.arbeitsagentur.de/datei/fw-sgb-iii-28a_ba037220.pdf",
      "covers": [
        "social.unemployment"
      ],
      "status": "Recherche b"
    },
    {
      "id": "deductions",
      "url": "https://www.gesetze-im-internet.de/estg/__10.html",
      "covers": [
        "deductions"
      ],
      "status": "Höchstbetrag aus 124800 × 24,7 % aufgerundet; AV nie Altersvorsorgeabzug"
    },
    {
      "id": "trade",
      "url": "https://www.gesetze-im-internet.de/gewstg/__11.html",
      "covers": [
        "tradeTax"
      ],
      "status": "Kein Abrunden des Messbetrags; §35 Begrenzung zusätzlich berücksichtigen"
    },
    {
      "id": "credit",
      "url": "https://www.gesetze-im-internet.de/estg/__35.html",
      "covers": [
        "tradeTax.creditMultiplier"
      ],
      "status": "Recherche c"
    },
    {
      "id": "vat",
      "url": "https://www.gesetze-im-internet.de/ustg_1980/__19.html",
      "covers": [
        "vat"
      ],
      "status": "PLAN/c; Gründungsjahr 25000, kein automatischer Rechnungsschalter"
    },
    {
      "id": "vat-periods",
      "url": "https://www.gesetze-im-internet.de/ustg_1980/__18.html",
      "covers": [
        "vat.monthlyAdvanceThreshold",
        "vat.advanceExemptionThreshold",
        "vat.filingDayAfterPeriod",
        "vat.founderMonthlySuspendedUntil"
      ],
      "status": "Primärquelle am 09.10.2026 geprüft: Kalendervierteljahr, monatlich über 9.000 €, Befreiung bis 2.000 €, Neugründer-Monatspflicht 2021–2026 ausgesetzt; Fälligkeit 10. Tag nach Ablauf"
    },
    {
      "id": "vat-extension",
      "url": "https://www.gesetze-im-internet.de/ustdv_1980/__47.html",
      "covers": [
        "vat.permanentExtensionMonths",
        "vat.specialPrepaymentDivisor",
        "vat.specialPrepaymentDueMonth",
        "vat.specialPrepaymentDueDay"
      ],
      "status": "§§ 46–48 UStDV: Fristverlängerung um einen Monat, Sondervorauszahlung 1/11 der Vorjahresvorauszahlungen bei Monatszahlern, Antrag/Zahlung bis 10. Februar; nicht im Volltext neu geöffnet"
    },
    {
      "id": "vat-cash",
      "url": "https://www.gesetze-im-internet.de/ustg_1980/__20.html",
      "covers": [
        "vat.cashAccountingPreviousLimit"
      ],
      "status": "Primärquelle laut c-RESULT: 800.000 € Vorjahresumsatz oder freiberufliche Umsätze; Ist-Versteuerung nur auf Antrag/Genehmigung"
    },
    {
      "id": "vat-form-2026",
      "url": "https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Vordrucke/",
      "covers": [
        "vat.kennzahlen"
      ],
      "status": "BMF-Schreiben vom 29.12.2025 (Vordruckmuster 2026) laut Sekundärquellen; Kz 81/86/66/83 sowie 46/47 und 84/85 für 2026 bestätigt; Kz 87, 35/36, 48, 67, 39 aus Vorjahresvordrucken, im Original 2026 nicht geöffnet"
    },
    {
      "id": "euer-ten-day",
      "url": "https://www.gesetze-im-internet.de/estg/__11.html",
      "covers": [
        "vat.tenDayRuleDays"
      ],
      "status": "§ 11 Abs. 2 Satz 2 EStG; BFH XI R 48/05 (USt-Vorauszahlung regelmäßig wiederkehrend), BFH X R 44/16 (gesetzliche Fälligkeit am 10.01. maßgeblich, keine Verschiebung nach § 108 Abs. 3 AO); bei Dauerfristverlängerung Fälligkeit außerhalb des Zeitraums"
    },
    {
      "id": "euer-form",
      "url": "https://www.elster.de/eportal/formulare-leistungen/alleformulare/euer",
      "covers": [
        "vat.euerKennzahlen"
      ],
      "status": "Anlage-EÜR-Kennzahlen 111/103/112/140/141/185/186 als Orientierung aus Vorjahresvordrucken; für 2026 nicht amtlich gegengeprüft"
    },
    {
      "id": "ihk",
      "url": "https://www.gesetze-im-internet.de/ihkg/__3.html",
      "covers": [
        "chambers"
      ],
      "status": "Recherche d; Voraussetzungen aus Nutzerangaben, keine kammerindividuelle Tarifannahme"
    },
    {
      "id": "hwk",
      "url": "https://www.gesetze-im-internet.de/hwo/__113.html",
      "covers": [
        "chambers"
      ],
      "status": "Recherche d; Beiträge nur Nutzereingabe"
    },
    {
      "id": "books",
      "url": "https://www.gesetze-im-internet.de/ao_1977/__141.html",
      "covers": [
        "bookkeeping"
      ],
      "status": "PLAN/c"
    },
    {
      "id": "advances",
      "url": "https://www.gesetze-im-internet.de/estg/__37.html",
      "covers": [
        "advancePayments"
      ],
      "status": "Recherche c; Bescheidbeträge, keine automatische Festsetzung"
    }
  ],
  "limitations": [
    "Kirchensteuer ohne Kappung und besondere Kirchgeldfälle",
    "Keine rechtliche Einstufung von Tätigkeit, Versicherungspflicht oder USt-Befreiung",
    "Umsatzsteuer-Zahllast aus erfassten Rechnungen und EÜR-Angaben als Orientierung; keine Voranmeldung, keine ELSTER-Übermittlung",
    "Gemischt genutzte Eingangsleistungen (steuerfrei/steuerpflichtig) ohne Aufteilungsautomatik; Anzahlungen, Forderungsausfälle (§ 17 UStG) und innergemeinschaftliche Lieferungen/Erwerbe nicht abgebildet",
    "Fälligkeiten verschieben sich nur um Wochenenden und bundeseinheitliche Feiertage; Landesfeiertage nicht berücksichtigt",
    "Kammerbeiträge ausschließlich aus Nutzerangaben",
    "Kein verifizierter Parametersatz vor/nach 2026"
  ]
};
