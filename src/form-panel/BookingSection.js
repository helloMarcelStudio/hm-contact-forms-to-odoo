/**
 * Booking request: the Odoo appointment type, the room the visitor picks
 * (a form field whose options are mapped to Odoo's resources) and the stay,
 * from two date fields with fixed arrival and departure times.
 */
import { __ } from '@wordpress/i18n';
import { useEffect } from '@wordpress/element';
import { TextControl } from '@wordpress/components';
import { data, useRecords } from './data';
import { HelpTip, OdooStatus, Select } from './controls';

export default function BookingSection( { booking, setBooking } ) {
	const types = useRecords( 'appointment.type' );
	const rooms = useRecords( 'appointment.resource' );
	const set = ( key ) => ( value ) =>
		setBooking( { ...booking, [ key ]: value } );

	const choiceTags = Object.keys( data.choices || {} );
	// date fields first, then any other field
	const dateTags = [
		...new Set( [ ...( data.dateTags || [] ), ...( data.tags || [] ) ] ),
	];
	const none = { value: '', label: __( '— Choose —', 'forms-to-odoo' ) };
	const tagOptions = ( tags ) => [
		none,
		...tags.map( ( t ) => ( { value: t, label: `[${ t }]` } ) ),
	];
	const recordOptions = ( list ) => [
		{ value: '0', label: __( '— Choose —', 'forms-to-odoo' ) },
		...( list || [] ).map( ( r ) => ( {
			value: String( r.id ),
			label: r.name,
		} ) ),
	];
	const roomOptions = booking.room_tag
		? data.choices[ booking.room_tag ] || []
		: [];

	// options named like an Odoo room are mapped to it, once the rooms load
	useEffect( () => {
		if ( ! rooms.records || ! roomOptions.length ) {
			return;
		}
		const guesses = {};
		roomOptions.forEach( ( option ) => {
			const id = booking.room_map?.[ option ]
				? 0
				: guessRoom( option, rooms.records );
			if ( id ) {
				guesses[ option ] = id;
			}
		} );
		if ( Object.keys( guesses ).length ) {
			setBooking( {
				...booking,
				room_map: { ...booking.room_map, ...guesses },
			} );
		}
	}, [ rooms.records, booking.room_tag ] ); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div className="fto-contact fto-booking">
			<h3 className="fto-heading-help">
				{ __( 'Booking', 'forms-to-odoo' ) }
				<HelpTip
					text={ __(
						'Each submission creates a booking request in Odoo Appointments, for the room and nights the visitor chose. Your team confirms it in Odoo. Availability is checked when the visitor sends the form.',
						'forms-to-odoo'
					) }
				/>
			</h3>
			<table className="widefat fto-mapping fto-contact-table">
				<thead>
					<tr>
						<th>{ __( 'Booking', 'forms-to-odoo' ) }</th>
						<th>{ __( 'Value', 'forms-to-odoo' ) }</th>
					</tr>
				</thead>
				<tbody>
					<Row
						label={ __( 'Appointment type', 'forms-to-odoo' ) }
						help={ __(
							'The Odoo appointment type the rooms belong to',
							'forms-to-odoo'
						) }
					>
						{ types.records ? (
							<Select
								label={ __(
									'Appointment type',
									'forms-to-odoo'
								) }
								hideLabelFromVision
								value={ String( booking.type_id || 0 ) }
								options={ recordOptions( types.records ) }
								onChange={ ( v ) =>
									set( 'type_id' )( Number( v ) )
								}
							/>
						) : (
							<OdooStatus
								loading={ ! types.error }
								error={ types.error }
							/>
						) }
					</Row>
					<Row
						label={ __( 'Room', 'forms-to-odoo' ) }
						help={ __(
							'The form field where the visitor picks the room',
							'forms-to-odoo'
						) }
					>
						{ choiceTags.length ? (
							<Select
								label={ __( 'Room', 'forms-to-odoo' ) }
								hideLabelFromVision
								value={ booking.room_tag }
								options={ tagOptions( choiceTags ) }
								onChange={ ( roomTag ) =>
									setBooking( {
										...booking,
										room_tag: roomTag,
										room_map: {},
									} )
								}
							/>
						) : (
							<p className="description">
								{ __(
									'Add a select or radio field with the rooms to the form, e.g. [select room "The Yellow Loft" "The Blue Loft"].',
									'forms-to-odoo'
								) }
							</p>
						) }
						{ roomOptions.length > 0 && (
							<>
								{ rooms.records ? (
									<table className="fto-choice-map">
										<thead>
											<tr>
												<th>
													{ __(
														'When the visitor chooses',
														'forms-to-odoo'
													) }
												</th>
												<th>
													{ __(
														'Book in Odoo',
														'forms-to-odoo'
													) }
												</th>
											</tr>
										</thead>
										<tbody>
											{ roomOptions.map( ( option ) => (
												<tr key={ option }>
													<td>{ option }</td>
													<td>
														<Select
															label={ option }
															hideLabelFromVision
															value={ String(
																booking
																	.room_map?.[
																	option
																] || 0
															) }
															options={ recordOptions(
																rooms.records
															) }
															onChange={ (
																v
															) => {
																const roomMap =
																	{
																		...booking.room_map,
																	};
																if (
																	Number( v )
																) {
																	roomMap[
																		option
																	] =
																		Number(
																			v
																		);
																} else {
																	delete roomMap[
																		option
																	];
																}
																setBooking( {
																	...booking,
																	room_map:
																		roomMap,
																} );
															} }
														/>
													</td>
												</tr>
											) ) }
										</tbody>
									</table>
								) : (
									<OdooStatus
										loading={ ! rooms.error }
										error={ rooms.error }
									/>
								) }
								<p className="description">
									{ __(
										'To preselect a room from its page, add default:get to the field, e.g. [select room default:get …], and link to the form with ?room=The+Blue+Loft.',
										'forms-to-odoo'
									) }
								</p>
							</>
						) }
					</Row>
					<StayRow
						label={ __( 'Arrival', 'forms-to-odoo' ) }
						tag={ booking.checkin_tag }
						time={ booking.checkin_time }
						options={ tagOptions( dateTags ) }
						onTag={ set( 'checkin_tag' ) }
						onTime={ set( 'checkin_time' ) }
					/>
					<StayRow
						label={ __( 'Departure', 'forms-to-odoo' ) }
						tag={ booking.checkout_tag }
						time={ booking.checkout_time }
						options={ tagOptions( dateTags ) }
						onTag={ set( 'checkout_tag' ) }
						onTime={ set( 'checkout_time' ) }
					/>
					<Row label={ __( 'Status in Odoo', 'forms-to-odoo' ) }>
						<strong>{ __( 'Request', 'forms-to-odoo' ) }</strong>
						<div className="description">
							{ __(
								'Your team confirms or refuses each booking in Odoo. Odoo sends the visitor no email meanwhile; the form’s own email acknowledges the request.',
								'forms-to-odoo'
							) }
						</div>
					</Row>
				</tbody>
			</table>
		</div>
	);
}

function StayRow( { label, tag, time, options, onTag, onTime } ) {
	return (
		<Row
			label={ label }
			help={ __( 'Date field, and time of day', 'forms-to-odoo' ) }
		>
			<div className="fto-stay">
				<Select
					label={ label }
					hideLabelFromVision
					value={ tag }
					options={ options }
					onChange={ onTag }
				/>
				<TextControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					type="time"
					label={ __( 'Time', 'forms-to-odoo' ) }
					hideLabelFromVision
					value={ time }
					onChange={ onTime }
				/>
			</div>
		</Row>
	);
}

// A row like the mapping's: what it is on the left, the control on the right
function Row( { label, help, children } ) {
	return (
		<tr>
			<td>
				<strong>{ label }</strong>
				{ help && <div className="description">{ help }</div> }
			</td>
			<td>{ children }</td>
		</tr>
	);
}

// Suggest the Odoo room with the same name as the form option
function guessRoom( option, records ) {
	const match = records.find(
		( r ) => r.name.trim().toLowerCase() === option.trim().toLowerCase()
	);
	return match ? match.id : 0;
}
