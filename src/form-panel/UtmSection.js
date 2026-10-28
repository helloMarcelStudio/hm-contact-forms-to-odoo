/**
 * Marketing source: the record's Source, Medium and Campaign, filled from
 * the UTM tags of the link the visitor arrived by. Only for models with
 * those fields (Odoo's utm.mixin, e.g. CRM leads).
 */
import { __ } from '@wordpress/i18n';
import { CheckboxControl } from '@wordpress/components';
import { usePanel } from './data';
import { HelpTip } from './controls';

export const UTM_FIELDS = {
	source_id: 'utm.source',
	medium_id: 'utm.medium',
	campaign_id: 'utm.campaign',
};

// Whether the model has Source, Medium and Campaign fields
export function hasUtmFields( fields ) {
	return Object.entries( UTM_FIELDS ).some(
		( [ name, relation ] ) => fields[ name ]?.relation === relation
	);
}

export default function UtmSection( { utm, setUtm } ) {
	const { fields } = usePanel();
	if ( ! hasUtmFields( fields ) ) {
		return null;
	}
	const set = ( key ) => ( value ) => setUtm( { ...utm, [ key ]: value } );

	return (
		<div className="fto-contact fto-utm">
			<h3 className="fto-heading-help">
				{ __( 'Marketing source', 'forms-to-odoo' ) }
				<HelpTip
					text={ __(
						'UTM tags are added to the links of ads, newsletters and social posts, e.g. ?utm_source=newsletter&utm_medium=email&utm_campaign=spring. They are remembered for 90 days in the visitor’s browser, across pages, until a form is sent.',
						'forms-to-odoo'
					) }
				/>
			</h3>
			<CheckboxControl
				__nextHasNoMarginBottom
				label={ __(
					'Fill Source, Medium and Campaign from the visitor’s UTM tags',
					'forms-to-odoo'
				) }
				help={ __(
					'Tells marketing which ad, newsletter or post brought each request.',
					'forms-to-odoo'
				) }
				checked={ !! utm.enabled }
				onChange={ set( 'enabled' ) }
			/>
			{ utm.enabled && (
				<table className="widefat fto-mapping fto-contact-table">
					<thead>
						<tr>
							<th>
								{ __( 'Marketing source', 'forms-to-odoo' ) }
							</th>
							<th>{ __( 'Value', 'forms-to-odoo' ) }</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<strong>
									{ __( 'Fields filled', 'forms-to-odoo' ) }
								</strong>
							</td>
							<td>
								{ Object.keys( UTM_FIELDS )
									.filter( ( name ) => fields[ name ] )
									.map(
										( name ) =>
											`${ fields[ name ].label } ← utm_${ name.replace(
												'_id',
												''
											) }`
									)
									.join( ' · ' ) }
								<div className="description">
									{ __(
										'A field set in the mapping below keeps its value.',
										'forms-to-odoo'
									) }
								</div>
							</td>
						</tr>
						<tr>
							<td>
								<strong>
									{ __(
										'What to do if the visitor has no UTM tags',
										'forms-to-odoo'
									) }
								</strong>
							</td>
							<td>
								<CheckboxControl
									__nextHasNoMarginBottom
									label={ __(
										'Use the website they came from as the source',
										'forms-to-odoo'
									) }
									help={ __(
										'e.g. Google with medium "organic", Facebook with "social", or the site’s domain with "referral".',
										'forms-to-odoo'
									) }
									checked={ !! utm.referrer }
									onChange={ set( 'referrer' ) }
								/>
							</td>
						</tr>
						<tr>
							<td>
								<strong>
									{ __(
										'What to do if Odoo doesn’t have it yet',
										'forms-to-odoo'
									) }
								</strong>
							</td>
							<td>
								<CheckboxControl
									__nextHasNoMarginBottom
									label={ __(
										'Create the source, medium or campaign',
										'forms-to-odoo'
									) }
									help={
										utm.create
											? null
											: __(
													'Unknown values leave the field empty.',
													'forms-to-odoo'
												)
									}
									checked={ !! utm.create }
									onChange={ set( 'create' ) }
								/>
							</td>
						</tr>
					</tbody>
				</table>
			) }
		</div>
	);
}
