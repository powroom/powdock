import { describe, expect, test } from 'bun:test'
import {
  brandReadsOn,
  contrastRatio,
  imageIconKey,
  imageInitial,
  namespaceName,
  relativeLuminance,
  repositoryName,
} from './image-icon'

describe('repositoryName', () => {
  test('keeps the last path segment without registry, tag or digest', () => {
    expect(repositoryName('postgres:17-alpine')).toBe('postgres')
    expect(repositoryName('bitnami/redis')).toBe('redis')
    expect(repositoryName('docker.io/library/nginx')).toBe('nginx')
    expect(repositoryName('ghcr.io/org/app:1.2')).toBe('app')
    expect(repositoryName('localhost:5000/team/tool@sha256:abc')).toBe('tool')
  })

  test('a registry port is not a tag', () => {
    expect(repositoryName('registry.local:5000/api')).toBe('api')
    expect(repositoryName('registry.local:5000/api:v2')).toBe('api')
  })

  test('is lower case', () => {
    expect(repositoryName('Library/MongoDB:7')).toBe('mongodb')
  })
})

describe('imageIconKey', () => {
  test('maps the common images and their aliases', () => {
    expect(imageIconKey('postgres:17-alpine')).toBe('postgresql')
    expect(imageIconKey('postgis/postgis:16')).toBe('postgresql')
    expect(imageIconKey('dpage/pgadmin4')).toBe('postgresql')
    expect(imageIconKey('mongo:7')).toBe('mongodb')
    expect(imageIconKey('bitnami/redis')).toBe('redis')
    expect(imageIconKey('valkey/valkey:8')).toBe('redis')
    expect(imageIconKey('docker.io/library/nginx')).toBe('nginx')
    expect(imageIconKey('eclipse-temurin:21')).toBe('openjdk')
    expect(imageIconKey('golang:1.23')).toBe('go')
    expect(imageIconKey('alpine:3.20')).toBe('alpinelinux')
    expect(imageIconKey('httpd:2.4')).toBe('apache')
    expect(imageIconKey('laravelsail/php84-composer')).toBe(null)
    expect(imageIconKey('portainer/portainer-ce:latest')).toBe('portainer')
    expect(imageIconKey('traefik:v3')).toBe('traefikproxy')
    expect(imageIconKey('keycloak/keycloak:26')).toBe('keycloak')
    expect(imageIconKey('gitlab/gitlab-ce')).toBe('gitlab')
  })

  test('unknown images and digests have no icon', () => {
    expect(imageIconKey('ghcr.io/org/app:1.0')).toBe(null)
    expect(imageIconKey('sha256:0123456789abcdef')).toBe(null)
    expect(imageIconKey('<none>')).toBe(null)
    expect(imageIconKey('ghcr.io/org/app:1.0')).toBe(null)
  })
})

describe('namespaceName', () => {
  test('is the segment before the name, lower case', () => {
    expect(namespaceName('mcr.microsoft.com/dotnet/sdk')).toBe('dotnet')
    expect(namespaceName('lscr.io/linuxserver/openssh-server')).toBe('linuxserver')
    expect(namespaceName('bitnami/redis')).toBe('bitnami')
    expect(namespaceName('Grafana/Loki:3')).toBe('grafana')
    expect(namespaceName('docker.io/library/nginx:1.27')).toBe('library')
  })

  test('the registry host is not a namespace, with or without a port', () => {
    expect(namespaceName('localhost:5000/team/tool@sha256:abc')).toBe('team')
    expect(namespaceName('registry.local:5000/api')).toBe('')
    expect(namespaceName('localhost/api')).toBe('')
  })

  test('is empty for a bare name', () => {
    expect(namespaceName('nginx')).toBe('')
    expect(namespaceName('nginx:latest')).toBe('')
  })
})

describe('imageIconKey lookup order', () => {
  test('the image name beats its namespace', () => {
    expect(imageIconKey('hashicorp/terraform')).toBe('terraform')
    expect(imageIconKey('linuxserver/nginx')).toBe('nginx')
  })

  test('a "namespace/name" pair is matched first, for generic names', () => {
    expect(imageIconKey('ghcr.io/goauthentik/server:2025.2')).toBe('authentik')
    expect(imageIconKey('vaultwarden/server:latest')).toBe('vaultwarden')
    expect(imageIconKey('ghcr.io/onlyoffice/documentserver')).toBe('onlyoffice')
    expect(imageIconKey('jitsi/web:stable')).toBe('jitsi')
    expect(imageIconKey('matrixdotorg/synapse:latest')).toBe('matrix')
  })

  test('a generic name alone has no icon', () => {
    expect(imageIconKey('server')).toBe(null)
    expect(imageIconKey('ghcr.io/someone/server:1')).toBe(null)
    expect(imageIconKey('documentserver')).toBe(null)
    expect(imageIconKey('web')).toBe(null)
    expect(imageIconKey('synapse')).toBe(null)
  })

  test('the namespace names the icon when the name does not', () => {
    expect(imageIconKey('linuxserver/openssh-server')).toBe('linuxserver')
    expect(imageIconKey('lscr.io/linuxserver/openssh-server')).toBe('linuxserver')
    expect(imageIconKey('mcr.microsoft.com/dotnet/sdk:8.0')).toBe('dotnet')
    expect(imageIconKey('confluentinc/cp-server')).toBe('apachekafka')
    expect(imageIconKey('elastic/filebeat')).toBe('elasticsearch')
    expect(imageIconKey('temporalio/auto-setup')).toBe('temporal')
    expect(imageIconKey('otel/collector')).toBe('opentelemetry')
  })

  test('an unknown namespace and names that are object properties have no icon', () => {
    expect(imageIconKey('bitnami/foo')).toBe(null)
    expect(imageIconKey('constructor/app')).toBe(null)
    expect(imageIconKey('constructor')).toBe(null)
  })
})

describe('imageInitial', () => {
  test('uses the first letter of the name, upper case', () => {
    expect(imageInitial('ghcr.io/org/app:1.0')).toBe('A')
    expect(imageInitial('qdrant/qdrant')).toBe('Q')
    expect(imageInitial('9front')).toBe('9')
  })

  test('is "?" for an image with no name', () => {
    expect(imageInitial('<none>')).toBe('?')
    expect(imageInitial('sha256:0123456789abcdef')).toBe('?')
    expect(imageInitial('')).toBe('?')
  })
})

describe('contrast', () => {
  test('black on white is 21 to 1', () => {
    expect(contrastRatio('000000', 'ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  test('luminance of white is 1 and of black is 0', () => {
    expect(relativeLuminance('ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('000000')).toBe(0)
  })

  test('a very light brand color is not clear enough on white', () => {
    expect(brandReadsOn('FFE14C', 'light')).toBe(false)
    expect(brandReadsOn('4169E1', 'light')).toBe(true)
  })

  test('a very dark brand color is not clear enough on the dark surface', () => {
    expect(brandReadsOn('181717', 'dark')).toBe(false)
    expect(brandReadsOn('47A248', 'dark')).toBe(true)
  })
})
