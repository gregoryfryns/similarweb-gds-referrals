import { CapabilitiesReply, KeywordsReply, ReferralsReply } from './types/similarweb-api';
import { buildUrl, httpGet, ApiConfiguration, EndpointType, cleanDomain, dateToYearMonth, retrieveOrGetAll } from './utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getAuthType(): object {
  const cc = DataStudioApp.createCommunityConnector();

  return cc.newAuthTypeResponse()
    .setAuthType(cc.AuthType.KEY)
    .setHelpUrl('https://account.similarweb.com/#/api-management')
    .build();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function resetAuth(): void {
  const userProperties = PropertiesService.getUserProperties();
  userProperties.deleteProperty('dscc.similarwebapi.key');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isAuthValid(): boolean {
  const userProperties = PropertiesService.getUserProperties();
  const key = userProperties.getProperty('dscc.similarwebapi.key');

  let data = null;

  if (key) {
    const response = UrlFetchApp.fetch('https://api.similarweb.com/capabilities?api_key=' + key, { muteHttpExceptions: true });
    data = JSON.parse(response.getContentText()) as CapabilitiesReply;
  }

  return (data && data.hasOwnProperty('remaining_hits'));
}

// TODO: look for a proper way to implement this function
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isAdminUser(): boolean {
  const adminUsersWhitelist = [
    'gregory.fryns@similarweb.com',
    'gregory.fryns@gmail.com'
  ];
  const email = Session.getEffectiveUser().getEmail();

  return adminUsersWhitelist.indexOf(email) > -1;
}

/**
 * Checks if the submitted key is valid
 * @param key The Similarweb API key to be checked
 * @return True if the key is valid, false otherwise
 */
function checkForValidKey(key: string): boolean {
  // Check key format
  if (!key.match(/[0-9a-f]{32}/i)) {
    return false;
  }

  // Check if key is valid
  const data = httpGet(buildUrl('https://api.similarweb.com/capabilities', { 'api_key': key }));

  return (data && data.hasOwnProperty('remaining_hits'));
}

/**
 * Sets the credentials.
 * @param request The set credentials request.
 * @return An object with an errorCode.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function setCredentials(request): object {
  const key = request.key.trim().toLowerCase();

  const isValid = checkForValidKey(key);
  if (!isValid) {
    return {
      errorCode: 'INVALID_CREDENTIALS'
    };
  }
  const userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('dscc.similarwebapi.key', key);

  return {
    errorCode: 'NONE'
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/camelcase
function getConfig(): GoogleAppsScript.Data_Studio.Config {
  const cc = DataStudioApp.createCommunityConnector();
  const config = cc.getConfig();

  config.newInfo()
    .setId('instructions')
    .setText('You can find your SimilarWeb API key or create a new one here (a SimilarWeb Pro account is needed): https://account.similarweb.com/#/api-management');

  config.newTextInput()
    .setId('domains')
    .setName('Domains')
    .setHelpText('Enter the name of up to 10 domains you would like to analyze, separated by commas (e.g. cnn.com, foxnews.com, washingtonpost.com, nytimes.com)')
    .setPlaceholder('e.g.: cnn.com, foxnews.com, washingtonpost.com, nytimes.com')
    .setAllowOverride(true);

  config.newTextInput()
    .setId('country')
    .setName('Country Code')
    .setHelpText('ISO 2-letter country code of the country (e.g. us, gb - world for Worldwide)')
    .setPlaceholder('e.g.: us')
    .setAllowOverride(true);

  config.setDateRangeRequired(true);

  return config.build();
}

// eslint-disable-next-line @typescript-eslint/camelcase
function getConnectorFields(): GoogleAppsScript.Data_Studio.Fields {
  const cc = DataStudioApp.createCommunityConnector();
  const fields = cc.getFields();
  const types = cc.FieldType;
  const aggregations = cc.AggregationType;

  fields.newDimension()
    .setId('domain')
    .setName('Domain')
    .setGroup('Dimensions')
    .setType(types.TEXT);

  fields.newDimension()
    .setId('referrer')
    .setName('Referrer')
    .setGroup('Dimensions')
    .setType(types.TEXT);

  fields.newDimension()
    .setId('device')
    .setName('Device')
    .setGroup('Dimensions')
    .setDescription('Device type: Desktop or Mobile Web')
    .setType(types.TEXT);

  fields.newMetric()
    .setId('visits')
    .setName('Visits')
    .setDescription('SimilarWeb estimated number of visits')
    .setType(types.NUMBER)
    .setIsReaggregatable(true)
    .setAggregation(aggregations.SUM);

  fields.setDefaultDimension('domain');
  fields.setDefaultMetric('visits');

  return fields;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getSchema(request): object {
  const fields = getConnectorFields().build();
  return { schema: fields };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/camelcase
function buildRow(requestedFields: GoogleAppsScript.Data_Studio.Fields, dom: string, referrer: string, device: string, value: number): any[] {
  const row = [];
  requestedFields.asArray().forEach((field): void => {
    switch (field.getId()) {
      case 'visits':
        row.push(value);
        break;
      case 'domain':
        row.push(dom);
        break;
      case 'device':
        row.push(device);
        break;
      case 'referrer':
        row.push(referrer);
        break;
      default:
        row.push('');
    }
  });

  return row;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getData(request): object {
  const MAX_NB_DOMAINS = 25;

  const country = request.configParams.country.trim().toLowerCase() as string;
  const domains = request.configParams.domains.split(',').slice(0, MAX_NB_DOMAINS).map(cleanDomain) as string[];
  const startDate = dateToYearMonth(request.dateRange.startDate);
  const endDate = dateToYearMonth(request.dateRange.endDate);

  const apiKey = PropertiesService.getUserProperties().getProperty('dscc.similarwebapi.key');
  const configurator = ApiConfiguration.getInstance();
  configurator.setApiKey(apiKey);

  const interval = configurator.getInterval(EndpointType.WebDesktopData);
  if (startDate < dateToYearMonth(interval.startDate) || dateToYearMonth(interval.endDate) < endDate) {
    DataStudioApp.createCommunityConnector()
      .newUserError()
      .setDebugText(`Invalid dates: [${startDate} - ${endDate}] not in [${interval.startDate} - ${interval.endDate}]`)
      .setText([
        'Invalid time period, please select dates between ',
        Utilities.formatDate(new Date(interval.startDate), 'GMT', 'dd MMM yyyy'),
        ' and ',
        Utilities.formatDate(new Date(interval.endDate), 'GMT', 'dd MMM yyyy'),
        '.'
      ].join(''))
      .throwException();
  }

  const params = configurator.getDefaultParams(EndpointType.WebDesktopData, country);
  const hasMobile = !!configurator.getDefaultParams(EndpointType.WebMobileData, country);

  params['start_date'] = startDate;
  params['end_date'] = endDate;

  const requestedFieldIDs = request.fields.map((field): string => field.name);
  console.log('requested fields ids', JSON.stringify(requestedFieldIDs));
  const requestedFields = getConnectorFields().forIds(requestedFieldIDs);

  const urls: string[] = [];
  domains.forEach((domain): void => {
    urls.push(buildUrl(`https://api.similarweb.com/v1/website/${domain}/traffic-sources/referrals`, params));
    if (hasMobile) {
      urls.push(buildUrl(`https://api.similarweb.com/v1/website/${domain}/traffic-sources/mobileweb-referrals`, params));
    }
  });

  const responses = retrieveOrGetAll(urls);

  const tabularData = [];
  domains.forEach((domain): void => {
    const dataDesktop = responses[buildUrl(`https://api.similarweb.com/v1/website/${domain}/traffic-sources/referrals`, params)] as ReferralsReply;

    const visits = dataDesktop.visits || 0;

    if (dataDesktop && dataDesktop.referrals) {
      dataDesktop.referrals.forEach((ref): void => {
        tabularData.push({ values: buildRow(requestedFields, domain, ref.domain, 'Desktop', visits * ref.share) });
      });
    }

    if (hasMobile) {
      const dataMobile = responses[buildUrl(`https://api.similarweb.com/v1/website/${domain}/traffic-sources/mobileweb-referrals`, params)] as ReferralsReply;
      if (dataMobile && dataMobile.referrals) {
        dataMobile.referrals.forEach((ref): void => {
          tabularData.push({ values: buildRow(requestedFields, domain, ref.domain, 'Mobile Web', visits * ref.share) });
        });
      }
    }
  });

  return {
    schema: requestedFields.build(),
    rows: tabularData
  };
}
