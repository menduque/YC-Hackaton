// AUTO-EXTRACTED from https://www.stedi.com/docs/healthcare/api-reference/mock-requests-eligibility-checks
// on 2026-08-01. These are Stedi's synthetic test-mode fixtures — no PHI/PII.
// Subscriber/dependent values must match EXACTLY or the payer returns an AAA error.
// Provider organizationName + NPI are free-form (NPI must pass check-digit validation).

export type MockCategory =
  | 'medical-active-dependent'
  | 'medical-active-subscriber'
  | 'mbi-lookup'
  | 'medical-inactive'
  | 'dental'
  | 'aaa-error'
  | 'stedi-agent';

export interface EligibilityRequest {
  controlNumber: string;
  tradingPartnerServiceId: string;
  provider: { organizationName: string; npi: string };
  subscriber: {
    firstName?: string;
    lastName: string;
    memberId: string;
    dateOfBirth?: string;
  };
  dependents?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    individualRelationshipCode: string;
  }[];
  encounter: { serviceTypeCodes: string[] };
}

export interface MockRequest {
  id: string;
  label: string;
  category: MockCategory;
  payerName: string;
  request: EligibilityRequest;
}

export const STEDI_ELIGIBILITY_ENDPOINT =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3';

export const MOCK_REQUESTS: MockRequest[] = [
  {
    id: 'aetna-dependent',
    label: "Aetna — Jordan Doe (dependent)",
    category: 'medical-active-dependent',
    payerName: "Aetna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "60054",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "AETNA9wcSu"
          },
          "dependents": [
                {
                      "firstName": "Jordan",
                      "lastName": "Doe",
                      "dateOfBirth": "20010714",
                      "individualRelationshipCode": "19"
                }
          ],
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'anthem-bcbsca-dependent',
    label: "Anthem Blue Cross Blue Shield of California — John Doe (dependent)",
    category: 'medical-active-dependent',
    payerName: "Anthem Blue Cross Blue Shield of California",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "040",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "CGMBCBSCA123"
          },
          "dependents": [
                {
                      "firstName": "John",
                      "lastName": "Doe",
                      "dateOfBirth": "19750101",
                      "individualRelationshipCode": "01"
                }
          ],
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'bcbstx-dependent',
    label: "Blue Cross and Blue Shield of Texas — Jane Doe (dependent)",
    category: 'medical-active-dependent',
    payerName: "Blue Cross and Blue Shield of Texas",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "G84980",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "A2CBCBSTX123"
          },
          "dependents": [
                {
                      "firstName": "Jane",
                      "lastName": "Doe",
                      "dateOfBirth": "20150101",
                      "individualRelationshipCode": "19"
                }
          ],
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cigna-dependent',
    label: "Cigna — Jordan Doe (dependent)",
    category: 'medical-active-dependent',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "CIGNAJTUxNm"
          },
          "dependents": [
                {
                      "firstName": "Jordan",
                      "lastName": "Doe",
                      "dateOfBirth": "20150920",
                      "individualRelationshipCode": "19"
                }
          ],
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'oscar-health-dependent',
    label: "Oscar Health — Jane Doe (dependent)",
    category: 'medical-active-dependent',
    payerName: "Oscar Health",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "OSCAR",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "OSCAR123456"
          },
          "dependents": [
                {
                      "firstName": "Jane",
                      "lastName": "Doe",
                      "dateOfBirth": "20010101",
                      "individualRelationshipCode": "19"
                }
          ],
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'unitedhealthcare-dependent',
    label: "UnitedHealthcare — Jane Doe (dependent)",
    category: 'medical-active-dependent',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "UHC202649"
          },
          "dependents": [
                {
                      "firstName": "Jane",
                      "lastName": "Doe",
                      "dateOfBirth": "19521121",
                      "individualRelationshipCode": "01"
                }
          ],
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'aetna',
    label: "Aetna — Jane Doe",
    category: 'medical-active-subscriber',
    payerName: "Aetna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "60054",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "AETNA12345",
                "dateOfBirth": "20040404"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'ambetter',
    label: "Centene (Medical) — John Doe",
    category: 'medical-active-subscriber',
    payerName: "Centene (Medical)",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "68069",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "AMBETTER123",
                "dateOfBirth": "19940404"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cigna',
    label: "Cigna — James Jones",
    category: 'medical-active-subscriber',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "James",
                "lastName": "Jones",
                "memberId": "23456789100",
                "dateOfBirth": "19910202"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cigna-2',
    label: "Cigna — Rolando Arrojo",
    category: 'medical-active-subscriber',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Rolando",
                "lastName": "Arrojo",
                "memberId": "5643296",
                "dateOfBirth": "19710102"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cigna-3',
    label: "Cigna — Rod Beck",
    category: 'medical-active-subscriber',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Rod",
                "lastName": "Beck",
                "memberId": "R5TJR4HR4H",
                "dateOfBirth": "19720203"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cigna-4',
    label: "Cigna — David Cone",
    category: 'medical-active-subscriber',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "David",
                "lastName": "Cone",
                "memberId": "5642296",
                "dateOfBirth": "19730304"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cigna-5',
    label: "Cigna — Frank Castillo",
    category: 'medical-active-subscriber',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Frank",
                "lastName": "Castillo",
                "memberId": "FTRJRG3254",
                "dateOfBirth": "19750405"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cigna-6',
    label: "Cigna — Casey Fossum",
    category: 'medical-active-subscriber',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Casey",
                "lastName": "Fossum",
                "memberId": "5641296",
                "dateOfBirth": "19760506"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cigna-7',
    label: "Cigna — Rich Garces",
    category: 'medical-active-subscriber',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Rich",
                "lastName": "Garces",
                "memberId": "DHW5445",
                "dateOfBirth": "19770607"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'humana',
    label: "Humana — Jane Doe",
    category: 'medical-active-subscriber',
    payerName: "Humana",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "61101",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "HUMANA123",
                "dateOfBirth": "19750505"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'kaiser-ncal',
    label: "Kaiser Foundation Health Plan Northern California — Jane Doe",
    category: 'medical-active-subscriber',
    payerName: "Kaiser Foundation Health Plan Northern California",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "KSRCN",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "KAISER123456",
                "dateOfBirth": "20020202"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cms',
    label: "CMS — Jane Doe",
    category: 'medical-active-subscriber',
    payerName: "CMS",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "CMS",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "CMS12345678",
                "dateOfBirth": "19550505"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'unitedhealthcare',
    label: "UnitedHealthcare — Jane Doe",
    category: 'medical-active-subscriber',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "UHC123456",
                "dateOfBirth": "19710101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'cms-mbi-lookup',
    label: "CMS MBI Lookup — Doe",
    category: 'mbi-lookup',
    payerName: "CMS MBI Lookup",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "MBILU",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "lastName": "Doe",
                "memberId": "123456789",
                "dateOfBirth": "19550505"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'unitedhealthcare-inactive',
    label: "UnitedHealthcare — Jane Doe",
    category: 'medical-inactive',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Provider Name",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "UHCINACTIVE",
                "dateOfBirth": "19710101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'ameritas-dental',
    label: "Ameritas — Falcon Dent",
    category: 'dental',
    payerName: "Ameritas",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "AMTAS00425",
          "provider": {
                "organizationName": "Penguin",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Falcon",
                "lastName": "Dent",
                "memberId": "007007007",
                "dateOfBirth": "19850607"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "35"
                ]
          }
    },
  },
  {
    id: 'anthem-bcbsca-dental',
    label: "Anthem Blue Cross Blue Shield of California — Aardvark Dent",
    category: 'dental',
    payerName: "Anthem Blue Cross Blue Shield of California",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "84103",
          "provider": {
                "organizationName": "One",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Aardvark",
                "lastName": "Dent",
                "memberId": "AFK987654321",
                "dateOfBirth": "19701212"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "35"
                ]
          }
    },
  },
  {
    id: 'cigna-dental',
    label: "Cigna — Jaguar Dent",
    category: 'dental',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "One",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jaguar",
                "lastName": "Dent",
                "memberId": "U3141592653",
                "dateOfBirth": "19960505"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "35"
                ]
          }
    },
  },
  {
    id: 'cigna-dental-procedure-code',
    label: "Cigna — James Doe",
    category: 'dental',
    payerName: "Cigna",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "62308",
          "provider": {
                "organizationName": "Smith Associates",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "James",
                "lastName": "Doe",
                "memberId": "U9876543210",
                "dateOfBirth": "19010101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "26"
                ]
          }
    },
  },
  {
    id: 'metlife-dental',
    label: "MetLife Dental Family — Elephant Dent",
    category: 'dental',
    payerName: "MetLife Dental Family",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "10134",
          "provider": {
                "organizationName": "One",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Elephant",
                "lastName": "Dent",
                "memberId": "88877788",
                "dateOfBirth": "19840229"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "35"
                ]
          }
    },
  },
  {
    id: 'uhc-dental',
    label: "UnitedHealthcare Dental — Beaver Dent",
    category: 'dental',
    payerName: "UnitedHealthcare Dental",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "52133",
          "provider": {
                "organizationName": "One",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Beaver",
                "lastName": "Dent",
                "memberId": "404404404",
                "dateOfBirth": "19690628"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "35"
                ]
          }
    },
  },
  {
    id: 'aaa-42',
    label: "UnitedHealthcare — Jane Doe",
    category: 'aaa-error',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Medical Provider",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "UHCAAA42",
                "dateOfBirth": "20010101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'aaa-43',
    label: "UnitedHealthcare — Jane Doe",
    category: 'aaa-error',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Medical Provider",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "UHCAAA43",
                "dateOfBirth": "19700101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'aaa-72',
    label: "UnitedHealthcare — John Doe",
    category: 'aaa-error',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Medical Provider",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "UHCAAA72",
                "dateOfBirth": "19900101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'aaa-73',
    label: "UnitedHealthcare — John Doe",
    category: 'aaa-error',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Medical Provider",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "UHCAAA73",
                "dateOfBirth": "19900101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'aaa-75',
    label: "UnitedHealthcare — Jane Doe",
    category: 'aaa-error',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Medical Provider",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "Jane",
                "lastName": "Doe",
                "memberId": "UHCAAA75",
                "dateOfBirth": "19900101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'aaa-79',
    label: "UnitedHealthcare — John Doe",
    category: 'aaa-error',
    payerName: "UnitedHealthcare",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "87726",
          "provider": {
                "organizationName": "Medical Provider",
                "npi": "1999999984"
          },
          "subscriber": {
                "firstName": "John",
                "lastName": "Doe",
                "memberId": "UHCAAA79",
                "dateOfBirth": "19700101"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
  {
    id: 'stedi-agent',
    label: "Stedi Test Payer — Bernie Prohas",
    category: 'stedi-agent',
    payerName: "Stedi Test Payer",
    request: {
          "controlNumber": "123456789",
          "tradingPartnerServiceId": "STEDI",
          "provider": {
                "organizationName": "STEDI",
                "npi": "1447848577"
          },
          "subscriber": {
                "firstName": "Bernie",
                "lastName": "Prohas",
                "memberId": "23051322"
          },
          "encounter": {
                "serviceTypeCodes": [
                      "30"
                ]
          }
    },
  },
];

export function getMockRequest(id: string): MockRequest {
  const found = MOCK_REQUESTS.find((m) => m.id === id);
  if (!found) {
    throw new Error(
      `Unknown mock request "${id}". Available: ${MOCK_REQUESTS.map((m) => m.id).join(', ')}`
    );
  }
  return found;
}
