/**
 * The "Odoo" tab of the Contact Form 7 editor. The settings live in the
 * hidden #fto-settings input (JSON), saved with the form.
 */
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs } from '@wordpress/url';
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import {
	Button,
	Notice,
	Spinner,
	TextControl,
	ToggleControl,
} from '@wordpress/components';
import { data, forgetRecords, PanelContext } from './data';
import { Select, TagButtons } from './controls';
import MappingRow from './MappingRow';
import ContactSection from './ContactSection';
import TestSection from './TestSection';
import Summary from './Summary';
import UtmSection from './UtmSection';
import BookingSection from './BookingSection';

const CONTACT_DEFAULTS = {
	enabled: false,
	email: '',
	name: '',
	phone: '',
	field: 'partner_id',
	create: true,
};

export default function App( { store } ) {
	const [ settings, setSettings ] = useState( () => {
		const saved = JSON.parse( store.value || '{}' );
		return {
			enabled: false,
			model: 'crm.lead',
			mapping: [],
			...saved,
			contact: { ...CONTACT_DEFAULTS, ...saved.contact },
			utm: { enabled: false, referrer: true, create: true, ...saved.utm },
			booking: {
				type_id: 0,
				room_tag: '',
				room_map: {},
				checkin_tag: '',
				checkout_tag: '',
				checkin_time: '15:00',
				checkout_time: '11:00',
				...saved.booking,
			},
		};
	} );
	const [ fields, setFields ] = useState( null ); // Odoo fields of the model, null while loading
	const [ fieldsError, setFieldsError ] = useState( '' );
	const [ generation, setGeneration ] = useState( 0 ); // bumped by "Refresh Odoo fields"
	const [ samples, setSamples ] = useState( () => ( { ...data.samples } ) );
	// test UTM tags, as if the visitor came from a newsletter link
	const [ utmSample, setUtmSample ] = useState( {
		source: 'newsletter',
		medium: 'email',
		campaign: 'spring_tours_2026',
	} );
	const [ modelDraft, setModelDraft ] = useState( settings.model );
	const tagTarget = useRef( null );
	const bypassCache = useRef( false ); // next fields load skips the server cache

	useEffect( () => {
		store.value = JSON.stringify( settings );
	}, [ settings, store ] );

	const update = ( patch ) => setSettings( ( s ) => ( { ...s, ...patch } ) );

	// Fields of the chosen model; a new mapping starts with the required ones
	const { model } = settings;
	useEffect( () => {
		if ( ! data.configured || ! model ) {
			return;
		}
		let live = true;
		setFields( null );
		setFieldsError( '' );
		const refresh = bypassCache.current;
		bypassCache.current = false;
		apiFetch( {
			path: addQueryArgs( '/fto/v1/fields', { model, refresh } ),
		} ).then(
			( loaded ) => {
				if ( ! live ) {
					return;
				}
				setFields( loaded );
				setSettings( ( s ) =>
					s.model !== model || s.mapping.length
						? s
						: {
								...s,
								mapping: Object.entries( loaded )
									.filter(
										( [ name, f ] ) =>
											f.required &&
											! bookingFills( model, name )
									)
									.map( ( [ name, f ] ) => ( {
										field: name,
										type: f.type,
										value: '',
									} ) ),
							}
				);
			},
			( e ) => {
				if ( ! live ) {
					return;
				}
				setFields( {} );
				setFieldsError( e.message );
			}
		);
		return () => {
			live = false;
		};
	}, [ model, generation ] );

	const refresh = () => {
		bypassCache.current = true;
		forgetRecords();
		setGeneration( ( g ) => g + 1 );
	};

	const chooseModel = ( next ) => {
		next = next.trim().toLowerCase();
		if ( next === settings.model ) {
			return;
		}
		setModelDraft( next );
		update( { model: next, mapping: [] } );
	};

	const setRow = ( index ) => ( row ) =>
		setSettings( ( s ) => ( {
			...s,
			mapping: s.mapping.map( ( r, i ) => ( i === index ? row : r ) ),
		} ) );
	const removeRow = ( index ) => () =>
		setSettings( ( s ) => ( {
			...s,
			mapping: s.mapping.filter( ( r, i ) => i !== index ),
		} ) );

	const context = useMemo(
		() => ( { fields: fields || {}, generation, samples, tagTarget } ),
		[ fields, generation, samples ]
	);
	const isKnown = Object.prototype.hasOwnProperty.call(
		data.models,
		settings.model
	);
	const ready = data.configured && settings.model && fields && ! fieldsError;

	return (
		<PanelContext.Provider value={ context }>
			<div className={ ready ? 'fto-layout' : undefined }>
				<div className="fto-main">
					<ToggleControl
						__nextHasNoMarginBottom
						label={ __(
							'Send submissions of this form to Odoo',
							'forms-to-odoo'
						) }
						checked={ !! settings.enabled }
						onChange={ ( enabled ) => update( { enabled } ) }
					/>

					<div className="fto-model">
						<Select
							label={ __( 'Create a', 'forms-to-odoo' ) }
							showSelectedHint
							value={ isKnown ? settings.model : '__other' }
							options={ [
								...Object.entries( data.models ).map(
									( [ key, label ] ) => ( {
										value: key,
										label,
										hint: key,
									} )
								),
								{
									value: '__other',
									label: __(
										'Other model…',
										'forms-to-odoo'
									),
								},
							] }
							onChange={ ( value ) =>
								value === '__other'
									? ( setModelDraft( '' ),
										update( { model: '', mapping: [] } ) )
									: chooseModel( value )
							}
						/>
						{ ! isKnown && (
							<TextControl
								__nextHasNoMarginBottom
								__next40pxDefaultSize
								label={ __(
									'Technical model name, e.g. x_bookings',
									'forms-to-odoo'
								) }
								value={ modelDraft }
								onChange={ setModelDraft }
								onBlur={ () => chooseModel( modelDraft ) }
							/>
						) }
						{ data.configured && settings.model && (
							<Button
								variant="link"
								onClick={ refresh }
								label={ __(
									'Fields and lists (sources, tags, teams…) are kept 10 minutes. Refresh after adding something in Odoo.',
									'forms-to-odoo'
								) }
								showTooltip
							>
								{ __( 'Refresh Odoo fields', 'forms-to-odoo' ) }
							</Button>
						) }
					</div>

					{ ! data.configured && (
						<Notice
							status="warning"
							isDismissible={ false }
							actions={ [
								{
									label: __(
										'Connect Odoo',
										'forms-to-odoo'
									),
									url: data.settingsUrl,
								},
							] }
						>
							{ __(
								'Connect Odoo first to choose fields.',
								'forms-to-odoo'
							) }
						</Notice>
					) }
					{ data.configured && settings.model && ! fields && (
						<p className="description">
							<Spinner />{ ' ' }
							{ __( 'Loading from Odoo…', 'forms-to-odoo' ) }
						</p>
					) }
					{ fieldsError && (
						<Notice status="error" isDismissible={ false }>
							{ fieldsError }
						</Notice>
					) }

					{ ready && (
						<>
							{ settings.model === 'calendar.event' && (
								<BookingSection
									booking={ settings.booking }
									setBooking={ ( booking ) =>
										update( { booking } )
									}
								/>
							) }
							<ContactSection
								model={ settings.model }
								contact={ settings.contact }
								setContact={ ( contact ) =>
									update( { contact } )
								}
							/>
							<UtmSection
								utm={ settings.utm }
								setUtm={ ( utm ) => update( { utm } ) }
							/>
							<Mapping
								settings={ settings }
								setRow={ setRow }
								removeRow={ removeRow }
							/>
							<Button
								variant="secondary"
								onClick={ () =>
									update( {
										mapping: [
											...settings.mapping,
											{
												field: '',
												type: 'char',
												value: '',
											},
										],
									} )
								}
							>
								{ __( 'Add a field', 'forms-to-odoo' ) }
							</Button>
							<MissingRequired
								fields={ fields }
								mapping={ settings.mapping }
								model={ settings.model }
							/>
							<TagButtons />
							<TestSection
								settings={ settings }
								samples={ samples }
								setSamples={ setSamples }
								utmSample={ utmSample }
								setUtmSample={ setUtmSample }
							/>
						</>
					) }
				</div>
				{ ready && (
					<Summary
						settings={ settings }
						samples={ samples }
						utmSample={ utmSample }
					/>
				) }
			</div>
		</PanelContext.Provider>
	);
}

function Mapping( { settings, setRow, removeRow } ) {
	const used = new Set( settings.mapping.map( ( r ) => r.field ) );
	return (
		<>
			<h3>{ __( 'Fields', 'forms-to-odoo' ) }</h3>
			<table className="widefat fto-mapping">
				<thead>
					<tr>
						<th>{ __( 'Odoo field', 'forms-to-odoo' ) }</th>
						<th>{ __( 'Value', 'forms-to-odoo' ) }</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{ settings.mapping.map( ( row, index ) => (
						// rows have no id of their own; the index is stable
						// enough as rows are only appended or removed
						<MappingRow
							key={ `${ index }-${ row.field }` }
							row={ row }
							setRow={ setRow( index ) }
							onRemove={ removeRow( index ) }
							usedFields={ used }
						/>
					) ) }
				</tbody>
			</table>
		</>
	);
}

// A field a booking request fills itself (dates, appointment type…)
function bookingFills( model, name ) {
	return (
		model === 'calendar.event' &&
		( data.bookingFields || [] ).includes( name )
	);
}

function MissingRequired( { fields, mapping, model } ) {
	const mapped = new Set( mapping.map( ( r ) => r.field ) );
	const missing = Object.entries( fields )
		.filter(
			( [ name, f ] ) =>
				f.required &&
				! mapped.has( name ) &&
				! bookingFills( model, name )
		)
		.map( ( [ , f ] ) => f.label );
	if ( ! missing.length ) {
		return null;
	}
	return (
		<Notice
			status="warning"
			isDismissible={ false }
			className="fto-missing"
		>
			{ sprintf(
				/* translators: %s: list of Odoo field labels */
				__(
					'Required in Odoo and not mapped (fine if Odoo fills in a default): %s',
					'forms-to-odoo'
				),
				missing.join( ', ' )
			) }
		</Notice>
	);
}
