// Decimal USD only: never infer provider credits or use floating-point multiplication.
export function usdBoundToMicrousd(value){
 if(typeof value!=='string'||!/^\d+(?:\.\d{1,6})?$/.test(value.trim()))throw Error('Enter a USD amount with at most six decimal places.');
 const [whole,fraction='']=value.trim().split('.');const amount=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
 if(amount<1n||amount>90071992547409n)throw Error('Enter a positive supported USD maximum.');return Number(amount);
}
