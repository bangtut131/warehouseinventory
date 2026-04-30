const crypto = require('crypto');
const fs = require('fs');

const rawKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDASYR8Lng1snVA
Vc56T+8wnkY/yMJuJExj/IqabCpzVj1ufFsKj0uWGuJ6GX12lWcDb9nFjUe8O2av
Z6fgDWv1AIB5zIGaccBzlttGWgfDcMupYyuwCWXN4JBHVWIW/r/+feJV/opyP4FC
PJWl07H+zcT05Dsmgj3jFfoPzNC1wNanQymMz/ejq2XEnL/FKIxo7UaFCEtnufEr
DTqSJflNge4KcN5JaCqE/ogpWdQXgZ1xDCNwkQ4ak6J8tqL/MY8zRxYrylhJ1KTB
Oy4WSD7/vgiHXtk3mHRrEOOiWfFCdwe+GznsRzacchDMJN26ftcQY4CcnMIMpLJd
ZXC1TL/nAgMBAAECggEAHS6LFrWOtMeCl+Lt1Q4whLZgfume6ExF856uAkWMI7jg
1dW1k2Kv2/X0jQc1TTvbSGA/MoYAbwaszM30YkJnMeWDmfh5atD8ng409PZQ205Q
+kH8rVifxKDiBJFms4qx5JOCN/7LUA9nNIAxTdtU1hCwZWIFwBBgCAibzK4OtqZs
AnS4xq+jziX6FiCeiKCFfI+LHoNCtLyoiZ0I4MeIWmj2R536+8SjD3fJpPuqz6I0
UFT9zM0go6cmRYjbvByst89j8+H4gabXjUM85iF/tMuPz+hOusQ4bU0xGVvlFk6d
DRexUBK+P3W35kafzIJFjsYBmbLibdgAKTBazEpSIQKBgQDof8BHAGzbF682MRbk
uZs7R4TV3TKjBxKYNCwhM8HkOLvuJacFBz2pnSs6fhX6lNKe5MUjsCCIR96u5Ttd
hFqMS4yu5rZyEKLE7iWrnEg0rZh76SM/KEwTFnjMSuLSoH1fcUXAHhG+XGx8W5wh
9YyKk4AVgFbtzp5REy7AVPLVWQKBgQDTuToDC9X/am1UEkuDmnqt0IJx1pEb8hhp
biovZ/SNSKEfpAXA6nUS5PjnuQcCCqmJ/O3V9PmFIj7qGiewocxVg858ZP79Pmku
onfucS/rRagHxF/69xRKOqi1UDuZgWW56cVnfEEln2lPJn7L2k7avv9PUeZ9EkHw
oB362TFXPwKBgQCwNZJ+vX3DF1I92jqlo15ZMT0l8X2dPZEENhZ0G4wJ8k3MklDh
aLl9QZcvv7vcrMpsjqozABvH7eCB4U569ALEbcX0EPuZu64BXxTB2bKH6kG1N970
0Q/HL7Lh8qeyRtx+Z5UbpC6Cff3iynOs8TNRG7VplllL5trqS4WVU0ywEQKBgGEM
4dutnD2FMnI8JKNBt4RfNLwr575QngIN/oZWd5IfvcO8Mur4TgwIK1REy0KTUp2u
8/KEZbAyP3ad4J2lvP1h+s+ol/3LkvlOff0toxKMjnZo/LoUcheIhfb+vSMjXlb3
IobKPS6awPIIKk0VV9oLfQqF90pTiShcrQFkd6qPAoGBAM1K9aLmzQ8hWY835e6+
DFn1YTHeLLK5k0pBxJN1EeF8zE+N5l58KKI7ZlpFcCQWGPgUH1L42KYXmJIuRhBa
Zeh1lRFfmGZKUm+l1V2yud9asXOcJHu3f0UBtlud3osZtLHMjuvK244GJY6kR6z3
gC6UzMsMHiAjpli4f3wKTdGp
-----END PRIVATE KEY-----`;

function bulletproof(key) {
    if (!key) return key;
    return key.replace(/^"|"$/g, '')
              .replace(/\\+n/g, '\n')
              .replace(/-----BEGIN PRIVATE KEY-----/g, '-----BEGIN_PRIVATE_KEY-----')
              .replace(/-----END PRIVATE KEY-----/g, '-----END_PRIVATE_KEY-----')
              .replace(/\s+/g, '\n')
              .replace(/-----BEGIN_PRIVATE_KEY-----/g, '-----BEGIN PRIVATE KEY-----')
              .replace(/-----END_PRIVATE_KEY-----/g, '-----END PRIVATE KEY-----');
}

function testKey(keyString, name) {
    try {
        const sign = crypto.createSign('SHA256');
        sign.update('test');
        sign.sign(bulletproof(keyString));
        console.log(`[SUCCESS] ${name}`);
    } catch (e) {
        console.log(`[FAILED] ${name}: ${e.message}`);
    }
}

testKey(rawKey.replace(/\n/g, ' '), "Nixpacks flattened (Spaces)");
testKey(rawKey.replace(/\n/g, '\\n'), "String literal \\n (Raw)");
testKey(`"${rawKey.replace(/\n/g, '\\n')}"`, "Quotes wrapped");
testKey(`"${rawKey.replace(/\n/g, '\\\\n')}"`, "Double escaped with quotes");
