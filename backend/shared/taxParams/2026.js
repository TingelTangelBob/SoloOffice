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
    "advanceExemptionThreshold": 2000
  },
  "chambers": {
    "ihkExemptionProfit": 5200,
    "ihkFounderProfitLimit": 25000,
    "ihkFounderExemptYears": 2,
    "ihkFounderLevyExemptYears": 4,
    "hwkFounderExemptYears": 1,
    "hwkFounderReducedYears": 4,
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
    "monthsPerYear": 12
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
    "Vorsteuer nur grobe Rücklage aus erfassten Sätzen; keine UStVA",
    "Kammerbeiträge ausschließlich aus Nutzerangaben",
    "Kein verifizierter Parametersatz vor/nach 2026"
  ]
};
