import { normalizeDeliveryPackage, validateDeliveryPackage } from './packageDelivery.ts'

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

Deno.test('B06a normalizes a website package without carrying social placement', () => {
  const value = normalizeDeliveryPackage({
    destination_type: 'website', placement_label: ' Hero ', website_page_section: ' Home / Hero ',
    social_platform: 'must clear', width: '1440', height: 900, usage_instructions: ' Exact export ',
  })
  assert(value.destination_type === 'website')
  assert(value.website_page_section === 'Home / Hero')
  assert(value.social_platform === '')
  assert(value.width === 1440 && value.height === 900)
})

Deno.test('B06a validates a complete social package and rejects empty versions', () => {
  const social = validateDeliveryPackage({
    destination_type: 'social', placement_label: 'Launch post', social_platform: 'LinkedIn',
    width: 1080, height: 1080, usage_instructions: 'Use unchanged',
  }, ['version-1', 'version-1'])
  assert(social.valid)
  assert(social.selected_version_ids.length === 1)
  const empty = validateDeliveryPackage({
    destination_type: 'social', placement_label: 'Launch post', social_platform: 'LinkedIn',
    width: 1080, height: 1080, usage_instructions: 'Use unchanged',
  }, [])
  assert(!empty.valid && empty.missing.includes('at least one exact asset version'))
})
