import { describe, expect, test } from 'bun:test'
import { isIpv4, isIpv4Cidr, isValidResourceName, networkAddressProblem } from './resource-names'

describe('isValidResourceName', () => {
  test('accepts letters, digits, dots, dashes and underscores after a letter or digit', () => {
    expect(isValidResourceName('pgdata')).toBe(true)
    expect(isValidResourceName('app_data-v2.1')).toBe(true)
    expect(isValidResourceName('1volume')).toBe(true)
    expect(isValidResourceName('a'.repeat(255))).toBe(true)
  })

  test('rejects an empty name, a leading dash or dot, spaces and slashes', () => {
    expect(isValidResourceName('')).toBe(false)
    expect(isValidResourceName('-data')).toBe(false)
    expect(isValidResourceName('.data')).toBe(false)
    expect(isValidResourceName('my data')).toBe(false)
    expect(isValidResourceName('team/data')).toBe(false)
    expect(isValidResourceName('a'.repeat(256))).toBe(false)
  })
})

describe('isIpv4', () => {
  test('accepts four parts from 0 to 255', () => {
    expect(isIpv4('172.20.0.1')).toBe(true)
    expect(isIpv4('0.0.0.0')).toBe(true)
    expect(isIpv4('255.255.255.255')).toBe(true)
  })

  test('rejects a wrong part count, a part over 255, and text', () => {
    expect(isIpv4('172.20.0')).toBe(false)
    expect(isIpv4('172.20.0.256')).toBe(false)
    expect(isIpv4('172.20.0.1/16')).toBe(false)
    expect(isIpv4('172.20.-1.1')).toBe(false)
    expect(isIpv4('gateway')).toBe(false)
    expect(isIpv4('')).toBe(false)
  })
})

describe('isIpv4Cidr', () => {
  test('accepts an IPv4 address with a prefix from 0 to 32', () => {
    expect(isIpv4Cidr('172.20.0.0/16')).toBe(true)
    expect(isIpv4Cidr('10.0.0.0/8')).toBe(true)
    expect(isIpv4Cidr('0.0.0.0/0')).toBe(true)
    expect(isIpv4Cidr('192.168.1.1/32')).toBe(true)
  })

  test('rejects a missing prefix, a prefix over 32, and IPv6', () => {
    expect(isIpv4Cidr('172.20.0.0')).toBe(false)
    expect(isIpv4Cidr('172.20.0.0/33')).toBe(false)
    expect(isIpv4Cidr('172.20.0.0/')).toBe(false)
    expect(isIpv4Cidr('172.20.0.0/016')).toBe(false)
    expect(isIpv4Cidr('172.20.0.300/16')).toBe(false)
    expect(isIpv4Cidr('fd00::/64')).toBe(false)
  })
})

describe('networkAddressProblem', () => {
  test('neither given is fine', () => {
    expect(networkAddressProblem('', '')).toBeNull()
  })

  test('a subnet and gateway together are fine', () => {
    expect(networkAddressProblem('172.20.0.0/16', '172.20.0.1')).toBeNull()
  })

  test('one of the two without the other is a problem', () => {
    // a subnet alone is fine: Docker picks the gateway
    expect(networkAddressProblem('172.20.0.0/16', '')).toBeNull()
    expect(networkAddressProblem('', '172.20.0.1')).toBe('Give a subnet with the gateway.')
  })

  test('a bad subnet or gateway is a problem', () => {
    expect(networkAddressProblem('172.20.0.0', '172.20.0.1')).toBe('The subnet must look like 172.20.0.0/16.')
    expect(networkAddressProblem('172.20.0.0/16', '172.20.0.300')).toBe(
      'The gateway must be an IPv4 address, such as 172.20.0.1.',
    )
  })
})
