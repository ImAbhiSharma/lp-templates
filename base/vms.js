const vms = {
  // settings: <?=json_encode($settings)?>,
  // flows: <?=json_encode($flows)?>,
  // compliances: <?=json_encode($compliances)?>,
  // contents: <?=json_encode($contents)?>,
  ... <?-JSON.stringify(vmsData)?>,
  runtime: {
    flow: 'he',
    step: 1,
    is_he_available: false,
    response: {}
  },
  init: function() {
    this.sparams = new URLSearchParams(window.location.search)
    this.sparams.set('operator', this.settings.operator)
    for(let i in this.compliances) {
      let compliance = this.compliances[i]
      for(let j in compliance) {
        this.sparams.set(`${i}[${j}]`, compliance[j])
      }
    }
    this.setLanguage('en')
    this.runtime.userLang = navigator.language || navigator.userLanguage
    // alert(this.runtime.userLang)
    for(let lid in this.contents) {
      if(this.runtime.userLang.startsWith(`${lid}`)) {
        this.setLanguage(lid)
      }
    }
  },
  setLanguage: function(lang) {
    this.runtime.lang = lang
    var tags = document.querySelectorAll('*[id^="content-"]')
    for (var i = 0; i < tags.length; i++) {
      if(!this.contents[lang]) { continue }
      let id = tags.item(i).getAttribute('id')
      let [x, key] = id.split('content-')
      // alert(x)
      let value = this.contents[lang][key]
      if(Array.isArray(value) && value.length) {
        value = value.join("<br />")
      }
      tags.item(i).innerHTML = value
    }
  },
  setFlowStep: function(flow, step) {
    step = step || 0
    this.runtime.flow = flow
    this.runtime.step = step
    var tags = document.querySelectorAll('*[id^="flow-"]')
    for (var i = 0; i < tags.length; i++) {
      tags.item(i).style.display = 'none'
    }
    let elementId = `flow-${flow}`
    if(step) {
      elementId = elementId + '-' + step
    }
    let currentFlowElement = document.getElementById(elementId)
    if(!currentFlowElement) { return }
    currentFlowElement.style.display = 'block'
    if(this.lp && this.lp.onFlowChange) {
      this.lp.onFlowChange(flow, step)
    }
    if(flow == 'otp' && step == 1) {
      this.lp.selectors.msisdn_input.focus()
    }
    if(flow == 'otp' && step == 2) {
      this.lp.selectors.otp_input.focus()
    }
  },
  setLoading: function(flag) {
    this.runtime.loading = flag
    this.lp.selectors.loader.style.display = flag ? 'block' : 'none'
  },
  setError: function(reason) {
    this.runtime.failure_reason = reason
    if(this.lp && this.lp.showError) {
      let message
      try {
        message = this.contents[this.runtime.lang].errorMessages[reason]
      } catch(error) {

      }
      message = message || 'Unexpected error, please try again'
      this.lp.showError(reason, message)
    }
    console.log('this', this);
    if(this.runtime.flow == 'otp') {
      if(this.runtime.step == 1) {
        this.lp.selectors.msisdn_input.focus()
      }
      if(this.runtime.step == 2) {
        this.lp.selectors.otp_input.focus()
      }
    }
  },
  fetch: async function(path) {
    let {flow, step} = this.runtime
    this.setFlowStep('loading')
    this.lp.selectors.error.style.display = 'none'
    this.setLoading(true)
    let url
    if(path.startsWith('http')) {
      url = path
    } else {
      url = `${this.settings.api_protocol}://${this.settings.api_hostname}${path}`
    }
    let apiResponse = await fetch(url)
    let jsonResponse = await apiResponse.json()
    this.setLoading(false)
    this.setFlowStep(flow, step)
    return jsonResponse
  },
  subscribe: async function() {
    let flow = this.flows[this.runtime.flow]
    if(!flow) { return this.showError('NO_FLOW') }
    if(flow.he_type == 'callback') {
      if(this.runtime.step == 1) {
        let data = await this.callback({
          ctype: 'he'
        })
        if(data.status == 'success' || this.sparams.get('he_dummy_test')) {
          this.is_he_available = true
          if(this.sparams.get('he_dummy_test')) {
            this.runtime.heResponse = {bizao_token: 'test', bizao_alias: 'test'}
          } else {
            this.runtime.heResponse = data
          }
          this.setFlowStep('he', 2)
          return
        } else {
          this.setFlowStep('otp', 1)
        }
      } else {
        for(let i in flow.pass_params || []) {
          let param = flow.pass_params[i]
          let heResponse = this.runtime.heResponse || {}
          this.sparams.set(param, heResponse[param])
        }
        let qs = this.sparams.toString()
        let data = await this.fetch(`/api/subscribe?${qs}`)
        if(data.status == 'success' || this.sparams.get('he_dummy_success')) {
          this.setFlowStep('success')
          return
        } else {
          return this.setError(data.failure_reason)
        }
      }
    }
  },
  callback: async function({ctype}) {
    let flow = this.flows.he
    let path = `/api/callback/${this.settings.operator}/${ctype}?_json=1&`
    let callbackURL = encodeURIComponent(`${this.settings.api_protocol}://${this.settings.api_hostname}${path}`)
    let url = flow.he_callback_proxy_url.replace('{callbackURL}', callbackURL)
    let data = await this.fetch(url)
    return data
  },
  prepareMsisdn: function() {
    let msisdn = this.lp.selectors.msisdn_input.value
    if(String(msisdn).startsWith('0') && String(msisdn).length == this.settings.local_msisdn_length+1) {
      msisdn = String(msisdn).substring(1, this.settings.local_msisdn_length+1)
      console.log('number starts with 0, removing it', msisdn)
    }
    this.runtime.msisdn = msisdn
    this.sparams.set('msisdn', `${this.settings.isd}${msisdn}`)
  },
  sendOTP: async function() {
    this.prepareMsisdn()
    if(String(this.runtime.msisdn).length !== this.settings.local_msisdn_length) {
      return this.setError('INVALID_MSISDN')
    }
    let qs = this.sparams.toString()
    let data = await this.fetch(`/api/sendOTP?${qs}`)
    this.runtime.response = data
    if(data.status == 'success') {
      this.setFlowStep('otp', 2)
    } else {
      this.setError(data.failure_reason, data.error)
    }
  },
  submitOTP: async function() {
    // this.prepareMsisdn()
    // this.sparams.set('msisdn', '')
    let pin = this.lp.selectors.otp_input.value
    this.sparams.set('pin', pin)
    if(String(pin).length !== this.settings.otp_length) {
      return this.setError('INVALID_OTP')
    }
    let qs = this.sparams.toString()
    let data = await this.fetch(`/api/submitOTP?${qs}`)
    this.runtime.response = data
    if(data.status == 'success') {
      this.setFlowStep('success')
    } else {
      this.setError(data.failure_reason, data.error)
    }
  },
  getRedirectParams: function() {
    let params = new URLSearchParams()
    if(this.sparams.get('msisdn')) {
      params.set('msisdn', this.sparams.get('msisdn'))
    }
    if(this.runtime.heResponse && this.runtime.heResponse.bizao_alias) {
      params.set('unique_id', this.runtime.heResponse.bizao_alias)
    }
    return params
  },
  redirectToContent: function() {
    let params = this.getRedirectParams()
    params.set('redirect', '/')
    window.location.href = `http://${vms.settings.portal_hostname}/api/login?${params.toString()}`
  },
  redirectToProfile: function() {
    let params = this.getRedirectParams()
    params.set('redirect', this.settings.portal_profile_page_path)
    window.location.href = `http://${vms.settings.portal_hostname}/api/login?${params.toString()}`
  }
}
