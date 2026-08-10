const plc = require('../plc');

describe('PLC Service (Modbus Mode)', () => {
  it('should initialize with connected state as true', () => {
    // Basic structural test
    expect(plc.state.connected).toBe(true);
  });

  it('should resolve parameter writes via legacy writeParameter method', async () => {
    const result = await plc.writeParameter('test', 123);
    expect(result).toBe(true);
    expect(plc.config.test).toBe(123);
  });
});
