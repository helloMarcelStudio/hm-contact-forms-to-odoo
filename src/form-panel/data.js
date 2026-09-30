/**
 * Data shared by the "Odoo" tab: what PHP printed for this form
 * (window.ftoData) and the Odoo records behind relational fields.
 */
import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs } from '@wordpress/url';
import {
	createContext,
	useContext,
	useEffect,
	useState,
} from '@wordpress/element';

// { configured, settingsUrl, models, tags, samples, choices, formId, textTypes }
export const data = window.ftoData || {};

export const MULTILINE = [ 'text', 'html' ];

/**
 * What every row needs: the model's Odoo fields, the test values, the
 * records generation (bumped by "Refresh Odoo fields") and the template
 * the form tag buttons insert into.
 */
export const PanelContext = createContext( {} );
export const usePanel = () => useContext( PanelContext );

// relation model => Promise of [{ id, name }], shared by all rows
const records = new Map();
let bypassCache = false;

// After "Refresh Odoo fields": forget the records, and skip the server cache once
export function forgetRecords() {
	records.clear();
	bypassCache = true;
}

function fetchRecords( relation ) {
	if ( ! records.has( relation ) ) {
		records.set(
			relation,
			apiFetch( {
				path: addQueryArgs( '/fto/v1/records', {
					model: relation,
					refresh: bypassCache,
				} ),
			} )
		);
	}
	return records.get( relation );
}

// Records of a relation: { records: [...] | null while loading, error }
export function useRecords( relation ) {
	const { generation } = usePanel();
	const [ state, setState ] = useState( { records: null, error: '' } );
	useEffect( () => {
		if ( ! relation ) {
			return;
		}
		let live = true;
		setState( { records: null, error: '' } );
		fetchRecords( relation ).then(
			( list ) => live && setState( { records: list, error: '' } ),
			( e ) => live && setState( { records: null, error: e.message } )
		);
		return () => {
			live = false;
		};
	}, [ relation, generation ] );
	return state;
}

/**
 * Odoo choices for a selection or relational field, as control options:
 * { options: [{ value, label }], loading, error }.
 *
 * @param {Object} field An Odoo field, as loaded from /fto/v1/fields.
 * @return {Object} The options and their loading state.
 */
export function useOdooOptions( field ) {
	const relational =
		field && field.type !== 'selection' ? field.relation : '';
	const { records: list, error } = useRecords( relational );
	if ( ! field ) {
		return { options: [], loading: false, error: '' };
	}
	if ( field.type === 'selection' ) {
		return {
			options: ( field.selection || [] ).map( ( [ value, label ] ) => ( {
				value,
				label,
			} ) ),
			loading: false,
			error: '',
		};
	}
	if ( ! relational ) {
		return { options: [], loading: false, error: '' };
	}
	return {
		options: ( list || [] ).map( ( r ) => ( {
			value: String( r.id ),
			label: r.name,
		} ) ),
		loading: ! list && ! error,
		error,
	};
}
