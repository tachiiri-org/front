import * as OTPAuth from 'otpauth';
const secret = process.argv[2];
const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
console.log(totp.generate());
