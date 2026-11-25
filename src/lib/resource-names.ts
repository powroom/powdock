// Checks for the names and addresses typed in the Create volume and Create network dialogs. They are
// pure, so the server and the dialogs share them, and the unit tests run without Docker.

/** A volume or network name: a letter or digit first, then letters, digits, dots, dashes or underscores. */
export const RESOURCE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/

export function isValidResourceName(value: string): boolean {
  return RESOURCE_NAME.test(value)
}

/** An IPv4 address in dotted form, each part 0 to 255 (no leading "+" or spaces). */
export function isIpv4(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** An IPv4 network in CIDR form such as "172.20.0.0/16". The prefix length is 0 to 32. */
export function isIpv4Cidr(value: string): boolean {
  const slash = value.indexOf('/')
  if (slash < 0) return false
  const prefix = value.slice(slash + 1)
  if (!/^\d{1,2}$/.test(prefix) || Number(prefix) > 32) return false
  return isIpv4(value.slice(0, slash))
}

/**
 * The problem with a subnet and gateway, or null when they are fine. Both are optional: without a gateway
 * Docker picks the first address of the subnet. A gateway needs a subnet to belong to.
 */
export function networkAddressProblem(subnet: string, gateway: string): string | null {
  if (subnet && !isIpv4Cidr(subnet)) return 'The subnet must look like 172.20.0.0/16.'
  if (gateway && !subnet) return 'Give a subnet with the gateway.'
  if (gateway && !isIpv4(gateway)) return 'The gateway must be an IPv4 address, such as 172.20.0.1.'
  return null
}
